import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVentanaPartido } from '@/lib/partidos'
import { safeError, isUUID } from '@/lib/validation'
import { internalFetch } from '@/lib/internalFetch'

// POST /api/inscripciones — inscribirse a un partido
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('baneado, fecha_liberacion, username')
    .eq('id', user.id)
    .single()

  if (profile?.baneado) {
    const liberacion = profile.fecha_liberacion
      ? new Date(profile.fecha_liberacion).toLocaleDateString('es-CO')
      : 'indefinido'
    return NextResponse.json(
      { error: `Estás suspendido hasta el ${liberacion}. Contacta al admin para más info.` },
      { status: 403 }
    )
  }

  let body: { partido_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await admin
    .from('partidos')
    .select('id, cupos_total, fecha, hora, hora_apertura, dias_antes_apertura')
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  const ventana = calcularVentanaPartido(partido)
  if (!ventana.abierta) {
    return NextResponse.json({ error: 'Las inscripciones no están abiertas para este partido.' }, { status: 400 })
  }

  const { data: yaInscrito } = await admin
    .from('inscripciones')
    .select('id, estado')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .single()

  if (yaInscrito) {
    return NextResponse.json(
      { error: `Ya estás inscrito en este partido (${yaInscrito.estado})` },
      { status: 409 }
    )
  }

  const { count: confirmados } = await admin
    .from('inscripciones')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('estado', 'confirmado')

  if ((confirmados ?? 0) < partido.cupos_total) {
    const { error } = await admin
      .from('inscripciones')
      .insert({ partido_id, player_id: user.id, estado: 'confirmado' })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    return NextResponse.json({ estado: 'confirmado' })
  } else {
    const { data: posicion } = await admin.rpc('siguiente_posicion_espera', { p_partido_id: partido_id })
    const { error } = await admin
      .from('inscripciones')
      .insert({ partido_id, player_id: user.id, estado: 'espera', posicion_espera: posicion })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    return NextResponse.json({ estado: 'espera', posicion_espera: posicion })
  }
}

// DELETE /api/inscripciones — cancelar inscripción
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { partido_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id, estado')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .single()

  if (!inscripcion) return NextResponse.json({ error: 'No estás inscrito en este partido' }, { status: 404 })

  await admin.from('inscripciones').delete().eq('id', inscripcion.id)

  if (inscripcion.estado === 'confirmado') {
    await admin.rpc('promover_espera', { p_partido_id: partido_id })
    internalFetch('/api/notify', { method: 'POST' }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

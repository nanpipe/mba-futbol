import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVentanaPartido } from '@/lib/partidos'
import { isUUID, isString, safeError } from '@/lib/validation'
import { sendPush } from '@/lib/push'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

const MAX_INVITADOS = 3

// POST /api/invitados — agregar un invitado al partido
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Verify player is approved
  const { data: playerProfile } = await supabase.from('profiles').select('aprobado, username').eq('id', user.id).single()
  if (!playerProfile?.aprobado) return NextResponse.json({ error: 'Tu cuenta aún no ha sido aprobada.' }, { status: 403 })

  let body: { partido_id?: unknown; nombre?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { partido_id, nombre } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
  if (!isString(nombre, 2, 80)) return NextResponse.json({ error: 'Nombre debe tener entre 2 y 80 caracteres' }, { status: 400 })

  // Verify inscription window is open
  const { data: partido } = await admin
    .from('partidos')
    .select('id, fecha, hora, hora_apertura, dias_antes_apertura')
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  const { abierta } = calcularVentanaPartido(partido)
  if (!abierta) return NextResponse.json({ error: 'Las inscripciones están cerradas' }, { status: 400 })

  // Check max invitees per player per match
  const { count } = await admin
    .from('invitados')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)

  if ((count ?? 0) >= MAX_INVITADOS) {
    return NextResponse.json({ error: `Máximo ${MAX_INVITADOS} invitados por partido` }, { status: 400 })
  }

  // Assign espera position within invitados queue
  const { data: maxPos } = await admin
    .from('invitados')
    .select('posicion_espera')
    .eq('partido_id', partido_id)
    .order('posicion_espera', { ascending: false })
    .limit(1)
    .single()

  const posicion = ((maxPos as { posicion_espera: number } | null)?.posicion_espera ?? 0) + 1

  const { error } = await admin
    .from('invitados')
    .insert({
      partido_id,
      player_id: user.id,
      nombre: (nombre as string).trim(),
      estado: 'espera',
      posicion_espera: posicion,
    })

  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
  await logActivity({ user_id: user.id, username: (playerProfile as { username?: string })?.username ?? '', accion: 'alta_invitado', detalles: { partido_id, nombre: nombre as string, fecha: (partido as { fecha?: string })?.fecha } })
  return NextResponse.json({ ok: true, mensaje: `${nombre} agregado a lista de espera de invitados.` })
}

// DELETE /api/invitados — eliminar un invitado
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { invitado_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { invitado_id } = body
  if (!isUUID(invitado_id)) return NextResponse.json({ error: 'invitado_id inválido' }, { status: 400 })

  // Only allow deleting own invitees
  const { data: inv } = await admin
    .from('invitados')
    .select('id, player_id')
    .eq('id', invitado_id)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitado no encontrado' }, { status: 404 })

  // Allow owner OR admin to delete
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  const callerRole = (callerProfile as { role?: string })?.role
  const isAdmin = callerRole === 'admin' || callerRole === 'superadmin'
  if (!isAdmin && inv.player_id !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  await admin.from('invitados').delete().eq('id', invitado_id)
  await logActivity({ user_id: user.id, accion: 'baja_invitado', detalles: { invitado_id } })
  return NextResponse.json({ ok: true })
}

// PATCH /api/invitados — admin confirms an invitado + notifies their invitador
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Admin only
  const { data: prof } = await admin.from('profiles').select('role, username').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin' && (prof as { role?: string })?.role !== 'superadmin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let body: { invitado_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { invitado_id } = body
  if (!isUUID(invitado_id)) return NextResponse.json({ error: 'invitado_id inválido' }, { status: 400 })

  // Fetch the invitado + invitador profile + partido info
  const { data: inv } = await admin
    .from('invitados')
    .select('id, nombre, estado, player_id, partido_id, profiles(username), partidos(fecha, dia_semana)')
    .eq('id', invitado_id as string)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitado no encontrado' }, { status: 404 })
  if (inv.estado === 'confirmado') return NextResponse.json({ error: 'Ya está confirmado' }, { status: 409 })

  // Check cupos: confirmed inscripciones + confirmed invitados must not exceed cupos_total
  const { data: partido } = await admin
    .from('partidos')
    .select('cupos_total')
    .eq('id', inv.partido_id)
    .single()

  const [{ count: confirmedIns }, { count: confirmedInv }] = await Promise.all([
    admin.from('inscripciones').select('id', { count: 'exact', head: true })
      .eq('partido_id', inv.partido_id).eq('estado', 'confirmado'),
    admin.from('invitados').select('id', { count: 'exact', head: true })
      .eq('partido_id', inv.partido_id).eq('estado', 'confirmado'),
  ])

  const totalConfirmados = (confirmedIns ?? 0) + (confirmedInv ?? 0)
  const cupos = (partido as { cupos_total: number } | null)?.cupos_total ?? 14

  if (totalConfirmados >= cupos) {
    return NextResponse.json(
      { error: `No hay cupos disponibles. Partido lleno (${totalConfirmados}/${cupos}).` },
      { status: 400 }
    )
  }

  // Confirm the invitado
  const { error } = await admin
    .from('invitados')
    .update({ estado: 'confirmado', posicion_espera: null })
    .eq('id', invitado_id as string)

  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

  // Push notification to the invitador
  const invPartido = inv.partidos as unknown as { fecha: string; dia_semana: string } | null
  const fechaStr = invPartido
    ? `${invPartido.dia_semana} ${new Date(invPartido.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}`
    : 'el partido'

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('player_id', inv.player_id)

  for (const sub of subs ?? []) {
    try {
      await sendPush(sub, {
        title: '¡Tu invitado entró al partido!',
        body: `${inv.nombre} fue confirmado para ${fechaStr}. ⚽`,
        url: '/',
      })
    } catch (pushErr: unknown) {
      if ((pushErr as { statusCode?: number }).statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }
  }

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'confirmar_invitado',
    detalles: { invitado_id, nombre: inv.nombre, invitador_id: inv.player_id },
  })

  return NextResponse.json({ ok: true, mensaje: `${inv.nombre} confirmado.` })
}

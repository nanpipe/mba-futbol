import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function verificarAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return user
}

// POST /api/admin — acciones de admin
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await verificarAdmin(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const body = await req.json()
  const { accion } = body

  // Banear usuario
  if (accion === 'banear') {
    const { player_id, razon, fecha_liberacion } = body
    const { error } = await admin
      .from('profiles')
      .update({
        baneado: true,
        fecha_ban: new Date().toISOString(),
        fecha_liberacion: fecha_liberacion || null,
        razon_ban: razon || 'Multa pendiente',
      })
      .eq('id', player_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

   // Eliminar de partidos futuros
  const hoy = new Date().toISOString().split('T')[0]
  const { data: inscripciones } = await admin
    .from('inscripciones')
    .select('id, partido_id, estado, partidos(fecha)')
    .eq('player_id', player_id)

  for (const ins of (inscripciones ?? [])) {
    const fecha = (ins as unknown as { partidos: { fecha: string } }).partidos?.fecha ?? ''
    if (fecha >= hoy) {
      await admin.from('inscripciones').delete().eq('id', ins.id)
      if (ins.estado === 'confirmado') {
        await admin.rpc('promover_espera', { p_partido_id: ins.partido_id })
        fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/notify`, { method: 'POST' })
          .catch(err => console.error('Notify error:', err))
      }
    }
  }

  return NextResponse.json({ ok: true, mensaje: 'Usuario suspendido y removido de partidos futuros.' })
}

  // Liberar ban (pagó multa)
  if (accion === 'liberar') {
    const { player_id } = body
    const { error } = await admin
      .from('profiles')
      .update({ baneado: false, fecha_ban: null, fecha_liberacion: null, razon_ban: null })
      .eq('id', player_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Remover de un partido específico
  if (accion === 'remover_partido') {
    const { player_id, partido_id } = body
    const { data: ins } = await admin
      .from('inscripciones')
      .select('id, estado')
      .eq('player_id', player_id)
      .eq('partido_id', partido_id)
      .single()

    if (!ins) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    await admin.from('inscripciones').delete().eq('id', ins.id)

    if (ins.estado === 'confirmado') {
      await admin.rpc('promover_espera', { p_partido_id: partido_id })
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/notify`, { method: 'POST' })
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

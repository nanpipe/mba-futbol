import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { balancearEquipos, type JugadorEquipo } from '@/lib/teamBalancer'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

async function getAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: p } = await supabase.from('profiles').select('role, username').eq('id', user.id).single()
  if (p?.role !== 'admin') return null
  return { ...user, username: (p as { username?: string })?.username ?? 'admin' }
}

// GET /api/equipos?partido_id=xxx — returns saved teams (any authenticated user)
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: equipos } = await admin
    .from('equipos')
    .select('id, nombre, confirmado')
    .eq('partido_id', partido_id)

  if (!equipos || equipos.length === 0) return NextResponse.json({ ok: true, equipos: null })

  const { data: jugadores } = await admin
    .from('equipo_jugadores')
    .select('equipo_id, player_id, profiles(id, username, avatar_url, posicion, habilidad)')
    .in('equipo_id', equipos.map(e => e.id))

  const byEquipo: Record<string, JugadorEquipo[]> = {}
  for (const row of (jugadores ?? [])) {
    const prof = (row as unknown as { profiles: JugadorEquipo }).profiles
    if (!byEquipo[row.equipo_id]) byEquipo[row.equipo_id] = []
    byEquipo[row.equipo_id].push(prof)
  }

  return NextResponse.json({
    ok: true,
    equipos: equipos.map(e => ({
      ...e,
      jugadores: byEquipo[e.id] ?? [],
    })),
  })
}

// POST /api/equipos — admin actions
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await getAdminUser(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { accion, partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // ── balancear: run algorithm, return teams (NOT saved) ─────────────────────
  if (accion === 'balancear') {
    const [{ data: ins }, { data: invs }] = await Promise.all([
      admin
        .from('inscripciones')
        .select('player_id, profiles(id, username, avatar_url, posicion, habilidad)')
        .eq('partido_id', partido_id as string)
        .eq('estado', 'confirmado'),
      admin
        .from('invitados')
        .select('id, nombre')
        .eq('partido_id', partido_id as string)
        .eq('estado', 'confirmado'),
    ])

    const jugadores: JugadorEquipo[] = (ins ?? [])
      .map(i => (i as unknown as { profiles: JugadorEquipo }).profiles)
      .filter(Boolean)

    // Add confirmed invitados as pseudo-players (habilidad 3.0, posicion cualquiera)
    for (const inv of invs ?? []) {
      jugadores.push({
        id: (inv as { id: string }).id,
        username: `${(inv as { nombre: string }).nombre} *`,
        avatar_url: null,
        posicion: 'cualquiera',
        habilidad: 3.0,
        isInvitado: true,
      })
    }

    const { equipoA, equipoB } = balancearEquipos(jugadores)
    return NextResponse.json({ ok: true, equipoA, equipoB })
  }

  // ── guardar: save (or overwrite) teams in DB ──────────────────────────────
  if (accion === 'guardar') {
    const { equipoA, equipoB } = body as {
      equipoA: { id: string }[]
      equipoB: { id: string }[]
    }

    // Delete existing teams for this match
    await admin.from('equipos').delete().eq('partido_id', partido_id as string)

    // Create team A
    const { data: tA } = await admin.from('equipos').insert({ partido_id, nombre: 'A' }).select().single()
    // Create team B
    const { data: tB } = await admin.from('equipos').insert({ partido_id, nombre: 'B' }).select().single()

    if (!tA || !tB) return NextResponse.json({ error: 'Error creando equipos' }, { status: 500 })

    // Fetch invitado IDs for this partido to exclude them (no profiles FK)
    const { data: invitadosIds } = await admin
      .from('invitados')
      .select('id')
      .eq('partido_id', partido_id as string)
    const invSet = new Set((invitadosIds ?? []).map((i: { id: string }) => i.id))

    const rowsA = (equipoA ?? [])
      .filter((p: { id: string }) => !invSet.has(p.id))
      .map((p: { id: string }) => ({ equipo_id: tA.id, player_id: p.id }))
    const rowsB = (equipoB ?? [])
      .filter((p: { id: string }) => !invSet.has(p.id))
      .map((p: { id: string }) => ({ equipo_id: tB.id, player_id: p.id }))

    if (rowsA.length) await admin.from('equipo_jugadores').insert(rowsA)
    if (rowsB.length) await admin.from('equipo_jugadores').insert(rowsB)

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'guardar_equipos', detalles: { partido_id, totalA: rowsA.length, totalB: rowsB.length } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos guardados como borrador.' })
  }

  // ── confirmar: lock teams + send push ─────────────────────────────────────
  if (accion === 'confirmar') {
    const { data: equipos } = await admin
      .from('equipos')
      .select('id, nombre')
      .eq('partido_id', partido_id as string)

    if (!equipos || equipos.length < 2) {
      return NextResponse.json({ error: 'Primero guarda los equipos.' }, { status: 400 })
    }

    // Mark confirmed
    await admin.from('equipos').update({ confirmado: true }).eq('partido_id', partido_id as string)
    await admin.from('partidos').update({ equipos_confirmados: true }).eq('id', partido_id as string)

    // Get player lists for notifications
    const { data: jAll } = await admin
      .from('equipo_jugadores')
      .select('equipo_id, player_id, profiles(username)')
      .in('equipo_id', equipos.map(e => e.id))

    const nombresPorEquipo: Record<string, string[]> = { A: [], B: [] }
    for (const row of (jAll ?? [])) {
      const eq = equipos.find(e => e.id === row.equipo_id)
      const username = (row as unknown as { profiles: { username: string } }).profiles?.username ?? ''
      if (eq) nombresPorEquipo[eq.nombre]?.push(username)
    }

    // Push notifications
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, player_id')
      .in('player_id', (jAll ?? []).map(r => r.player_id))

    const { sendPush } = await import('@/lib/push')
    for (const sub of (subs ?? [])) {
      const equipo = (jAll ?? []).find(j => j.player_id === sub.player_id)
      const nombreEq = equipos.find(e => e.id === equipo?.equipo_id)?.nombre ?? '?'
      await sendPush(sub, {
        title: `⚽ Equipo ${nombreEq} confirmado`,
        body: `Juegas en el Equipo ${nombreEq}. Revisa la alineación en la app.`,
        url: '/',
      }).catch(() => {})
    }

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'confirmar_equipos', detalles: { partido_id } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos confirmados y jugadores notificados.' })
  }

  // ── resetear: delete teams for a match ────────────────────────────────────
  if (accion === 'resetear') {
    await admin.from('equipos').delete().eq('partido_id', partido_id as string)
    await admin.from('partidos').update({ equipos_confirmados: false }).eq('id', partido_id as string)
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'resetear_equipos', detalles: { partido_id } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos eliminados.' })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

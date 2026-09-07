import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { type JugadorEquipo } from '@/lib/teamBalancer'
import { cargarContexto, calcularEquipos, persistirEquipos } from '@/lib/teamDraft'
import { logActivity } from '@/lib/activityLog'
import { getClubNombre } from '@/lib/club'

export const dynamic = 'force-dynamic'

async function getAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: p } = await supabase.from('profiles').select('role, username, club_id').eq('id', user.id).single()
  if (p?.role !== 'admin' && p?.role !== 'superadmin') return null
  return { ...user, username: (p as { username?: string })?.username ?? 'admin', club_id: (p as { club_id?: string })?.club_id }
}

// GET /api/equipos?partido_id=xxx — returns saved teams (any authenticated user)
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await admin.from('profiles').select('club_id').eq('id', user.id).single()
  if (!profile?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = profile.club_id

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: equipos } = await admin
    .from('equipos')
    .select('id, nombre, confirmado, color, portero_fijo, portero_fijo_id, rotacion_banca, rotacion_portero')
    .eq('club_id', clubId)
    .eq('partido_id', partido_id)

  if (!equipos || equipos.length === 0) return NextResponse.json({ ok: true, equipos: null })

  const [{ data: jugadores }, { data: invitadosEnEquipo }] = await Promise.all([
    admin
      .from('equipo_jugadores')
      .select('equipo_id, player_id, profiles(id, username, avatar_url, posicion, posiciones, habilidad)')
      .in('equipo_id', equipos.map(e => e.id)),
    admin
      .from('invitados')
      .select('id, nombre, equipo_id')
      .in('equipo_id', equipos.map(e => e.id)),
  ])

  // Rating is the stateful 1–5 score on profiles.habilidad (v2).
  const byEquipo: Record<string, JugadorEquipo[]> = {}
  for (const row of (jugadores ?? [])) {
    const prof = (row as unknown as { profiles: JugadorEquipo }).profiles
    if (!byEquipo[row.equipo_id]) byEquipo[row.equipo_id] = []
    byEquipo[row.equipo_id].push(prof)
  }
  // Re-attach invitados to their team
  for (const inv of (invitadosEnEquipo ?? []) as { id: string; nombre: string; equipo_id: string }[]) {
    if (!inv.equipo_id) continue
    if (!byEquipo[inv.equipo_id]) byEquipo[inv.equipo_id] = []
    byEquipo[inv.equipo_id].push({
      id: inv.id,
      username: `${inv.nombre} *`,
      avatar_url: null,
      posicion: 'cualquiera',
      habilidad: 3.0,
      isInvitado: true,
    } as JugadorEquipo)
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
  if (!adminUser.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = adminUser.club_id

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { accion, partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // ── balancear: suggest teams (Gemini, snake-draft fallback) ───────────────
  // The actual algorithm lives in lib/teamDraft so the cron's auto-draft and
  // this endpoint can never drift apart.
  if (accion === 'balancear') {
    const ctx = await cargarContexto(admin, partido_id as string, clubId)
    const draft = await calcularEquipos(ctx)
    return NextResponse.json({
      ok: true,
      equipoA: draft.equipoA,
      equipoB: draft.equipoB,
      ...(ctx.esMinitorneo ? { equipoC: draft.equipoC ?? [] } : {}),
      razon: draft.razon,
      source: draft.source,
    })
  }

  // ── guardar: save (or overwrite) teams in DB ──────────────────────────────
  if (accion === 'guardar') {
    const { equipoA, equipoB, equipoC } = body as {
      equipoA: { id: string }[]
      equipoB: { id: string }[]
      equipoC?: { id: string }[]
    }
    const esMinitorneo = !!equipoC

    const saved = await persistirEquipos(admin, partido_id as string, clubId, { equipoA, equipoB, equipoC })
    if (!saved.ok) return NextResponse.json({ error: saved.error ?? 'Error guardando equipos' }, { status: 500 })

    await logActivity({
      user_id: adminUser.id,
      username: adminUser.username,
      accion: 'guardar_equipos',
      detalles: { partido_id, totalA: saved.totales[0], totalB: saved.totales[1], ...(esMinitorneo ? { totalC: saved.totales[2] } : {}) },
    })
    return NextResponse.json({ ok: true, mensaje: esMinitorneo ? 'Tres equipos guardados como borrador.' : 'Equipos guardados como borrador.' })
  }

  // ── confirmar: lock teams + send push ─────────────────────────────────────
  if (accion === 'confirmar') {
    const { data: equipos } = await admin
      .from('equipos')
      .select('id, nombre')
      .eq('club_id', clubId)
      .eq('partido_id', partido_id as string)

    const { data: pTipoConf } = await admin.from('partidos').select('tipo').eq('id', partido_id as string).eq('club_id', clubId).maybeSingle()
    if (!pTipoConf) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })
    const esMinitorneoConf = (pTipoConf as { tipo?: string })?.tipo === 'minitorneo'
    const minEquipos = esMinitorneoConf ? 3 : 2

    if (!equipos || equipos.length < minEquipos) {
      return NextResponse.json({ error: `Primero guarda los equipos (se necesitan ${minEquipos}).` }, { status: 400 })
    }

    // Mark confirmed
    await admin.from('equipos').update({ confirmado: true }).eq('partido_id', partido_id as string).eq('club_id', clubId)
    await admin.from('partidos').update({ equipos_confirmados: true }).eq('id', partido_id as string).eq('club_id', clubId)

    // Get player lists for notifications (include email for fallback)
    const { data: jAll } = await admin
      .from('equipo_jugadores')
      .select('equipo_id, player_id, profiles(username, email)')
      .in('equipo_id', equipos.map(e => e.id))

    type JugadorRow = { equipo_id: string; player_id: string; profiles: { username: string; email: string } }

    const nombresPorEquipo: Record<string, string[]> = { A: [], B: [], C: [] }
    for (const row of (jAll ?? []) as unknown as JugadorRow[]) {
      const eq = equipos.find(e => e.id === row.equipo_id)
      const username = row.profiles?.username ?? ''
      if (eq) {
        if (!nombresPorEquipo[eq.nombre]) nombresPorEquipo[eq.nombre] = []
        nombresPorEquipo[eq.nombre].push(username)
      }
    }

    const colorLabels: Record<string, string> = { A: 'Blanco', B: 'Negro', C: 'Morado' }
    const playerIds = (jAll ?? []).map((r: unknown) => (r as JugadorRow).player_id)

    // Push notifications
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, player_id')
      .in('player_id', playerIds)

    const { sendPush, isDeadPushError } = await import('@/lib/push')
    const subsPlayerIds = new Set((subs ?? []).map((s: { player_id: string }) => s.player_id))

    for (const sub of (subs ?? [])) {
      const equipo = (jAll as unknown as JugadorRow[])?.find(j => j.player_id === sub.player_id)
      const nombreEq = equipos.find(e => e.id === equipo?.equipo_id)?.nombre ?? '?'
      const colorEq = colorLabels[nombreEq] ?? nombreEq
      try {
        await sendPush(sub, {
          title: `⚽ Equipo ${colorEq} confirmado`,
          body: `Juegas con el equipo ${colorEq}. Revisa la alineación en la app.`,
          url: '/',
        })
      } catch (err) {
        if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        else console.error('[equipos] sendPush failed:', err)
      }
    }

    // Email fallback — players without push subscription
    const { sendEquipoConfirmado } = await import('@/lib/email')
    const sinPush = (jAll as unknown as JugadorRow[])?.filter(j => !subsPlayerIds.has(j.player_id)) ?? []
    for (const jugador of sinPush) {
      const email = jugador.profiles?.email
      const username = jugador.profiles?.username ?? '?'
      const nombreEq = equipos.find(e => e.id === jugador.equipo_id)?.nombre ?? '?'
      const colorEq = colorLabels[nombreEq] ?? nombreEq
      const compañeros = (nombresPorEquipo[nombreEq] ?? []).filter(n => n !== username)
      if (email) {
        await sendEquipoConfirmado({ email, username, colorEq, compañeros, clubNombre: getClubNombre(req) }).catch(() => {})
      }
    }

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'confirmar_equipos', detalles: { partido_id } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos confirmados y jugadores notificados.' })
  }

  // ── resetear: delete teams for a match ────────────────────────────────────
  if (accion === 'resetear') {
    // FK on delete set null clears invitados.equipo_id automatically
    await admin.from('equipos').delete().eq('partido_id', partido_id as string).eq('club_id', clubId)
    await admin.from('partidos').update({ equipos_confirmados: false }).eq('id', partido_id as string).eq('club_id', clubId)
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'resetear_equipos', detalles: { partido_id } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos eliminados.' })
  }

  // ── guardar_rotacion: save colors + rotation queues ───────────────────────
  if (accion === 'guardar_rotacion') {
    const { rotaciones } = body as {
      rotaciones: {
        equipo_id: string
        color: string
        portero_fijo: boolean
        portero_fijo_id: string | null
        rotacion_banca: string[]
        rotacion_portero: string[]
      }[]
    }
    if (!Array.isArray(rotaciones) || rotaciones.length === 0) {
      return NextResponse.json({ error: 'rotaciones requeridas' }, { status: 400 })
    }
    await Promise.all(rotaciones.map(r =>
      admin.from('equipos').update({
        color: r.color,
        portero_fijo: r.portero_fijo,
        portero_fijo_id: r.portero_fijo_id ?? null,
        rotacion_banca: r.rotacion_banca,
        rotacion_portero: r.rotacion_portero,
      }).eq('id', r.equipo_id).eq('club_id', clubId).eq('partido_id', partido_id as string)
    ))
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'guardar_rotacion', detalles: { partido_id } })
    return NextResponse.json({ ok: true, mensaje: 'Rotaciones guardadas.' })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

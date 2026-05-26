import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'
import { CATEGORIAS } from '@/lib/categorias'
import { getClubId } from '@/lib/club'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIAS: Set<string> = new Set(CATEGORIAS.map(c => c.id))

// ── Shared: tally votes → assign player_badges ────────────────────────────────
export async function tallyAndAssign(
  admin: ReturnType<typeof createAdminClient>,
  partido_id: string
): Promise<{ badges_asignados: number }> {
  const { data: votos } = await admin
    .from('votos_reconocimiento')
    .select('votado_id, categoria')
    .eq('partido_id', partido_id)

  if (!votos || votos.length === 0) return { badges_asignados: 0 }

  const tally: Record<string, Record<string, number>> = {}
  for (const v of votos) {
    if (!tally[v.categoria]) tally[v.categoria] = {}
    tally[v.categoria][v.votado_id] = (tally[v.categoria][v.votado_id] ?? 0) + 1
  }

  let badges_asignados = 0
  for (const cat of CATEGORIAS) {
    const catVotes = tally[cat.id]
    if (!catVotes) continue
    const [winnerId] = Object.entries(catVotes).reduce(
      (best, curr) => curr[1] > best[1] ? curr : best,
      ['', 0]
    )
    if (!winnerId) continue
    await admin.from('player_badges').upsert({
      player_id: winnerId,
      badge_id: cat.id,
      badge_emoji: cat.emoji,
      badge_nombre: cat.nombre,
      partido_id,
    }, { onConflict: 'player_id,badge_id,partido_id' })
    badges_asignados++
  }

  return { badges_asignados }
}

// ── GET /api/evaluaciones?partido_id=xxx ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const clubId = getClubId(req)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas, fecha, dia_semana')
    .eq('club_id', clubId)
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  // Must be a confirmed participant
  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .eq('estado', 'confirmado')
    .maybeSingle()

  if (!inscripcion) return NextResponse.json({ error: 'No estás en la lista de este partido' }, { status: 403 })

  // Already voted?
  const { count } = await admin
    .from('votos_reconocimiento')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('votante_id', user.id)

  const yaVoto = (count ?? 0) > 0

  // Teammates to vote for (only needed when open)
  const { data: compañeros } = partido.evaluaciones_abiertas ? await admin
    .from('inscripciones')
    .select('player_id, profiles!player_id(id, username, avatar_url, posicion)')
    .eq('partido_id', partido_id)
    .eq('estado', 'confirmado')
    .neq('player_id', user.id) : { data: null }

  // Results: badge winners + vote counts (when closed or just voted)
  let resultados: { categoria: string; emoji: string; nombre: string; ganador: string; votos: number }[] | null = null
  if (!partido.evaluaciones_abiertas || yaVoto) {
    const { data: badges } = await admin
      .from('player_badges')
      .select('badge_id, badge_emoji, badge_nombre, profiles!player_badges_player_id_fkey(username)')
      .eq('partido_id', partido_id)

    if (badges && badges.length > 0) {
      // Count votes per category for display
      const { data: votosData } = await admin
        .from('votos_reconocimiento')
        .select('votado_id, categoria')
        .eq('partido_id', partido_id)

      const tally: Record<string, Record<string, number>> = {}
      for (const v of (votosData ?? [])) {
        if (!tally[v.categoria]) tally[v.categoria] = {}
        tally[v.categoria][v.votado_id] = (tally[v.categoria][v.votado_id] ?? 0) + 1
      }

      resultados = badges.map(b => {
        const catVotes = tally[b.badge_id] ?? {}
        const profile = (b as unknown as { profiles: { username: string } | null }).profiles
        const ganadorId = Object.entries(catVotes).reduce(
          (best, curr) => curr[1] > best[1] ? curr : best, ['', 0]
        )[0]
        const voteCount = catVotes[ganadorId] ?? 0
        return {
          categoria: b.badge_id,
          emoji: b.badge_emoji,
          nombre: b.badge_nombre,
          ganador: profile?.username ?? '?',
          votos: voteCount,
        }
      })
    }
  }

  // Voting progress (when open)
  let progreso: { votaron: number; total: number } | null = null
  if (partido.evaluaciones_abiertas) {
    const { data: todosVotantes } = await admin
      .from('votos_reconocimiento')
      .select('votante_id')
      .eq('partido_id', partido_id)
    const { count: totalConfirmados } = await admin
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('partido_id', partido_id)
      .eq('estado', 'confirmado')
    const uniqueVotantes = new Set((todosVotantes ?? []).map(v => v.votante_id)).size
    progreso = { votaron: uniqueVotantes, total: totalConfirmados ?? 0 }
  }

  return NextResponse.json({
    ok: true,
    abierto: partido.evaluaciones_abiertas,
    yaVoto,
    partido: { fecha: partido.fecha, dia_semana: partido.dia_semana },
    compañeros: (compañeros ?? []).map(c => (c as unknown as { profiles: object }).profiles),
    resultados,
    progreso,
  })
}

// ── POST /api/evaluaciones — submit votes ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const clubId = getClubId(req)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id, votos } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas')
    .eq('club_id', clubId)
    .eq('id', partido_id)
    .single()

  if (!partido?.evaluaciones_abiertas) {
    return NextResponse.json({ error: 'La votación no está abierta.' }, { status: 403 })
  }

  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .eq('estado', 'confirmado')
    .maybeSingle()

  if (!inscripcion) return NextResponse.json({ error: 'No participaste en este partido.' }, { status: 403 })

  const { count: yaVoto } = await admin
    .from('votos_reconocimiento')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('votante_id', user.id)

  if ((yaVoto ?? 0) > 0) {
    return NextResponse.json({ error: 'Ya enviaste tus votos.' }, { status: 409 })
  }

  const { data: confirmados } = await admin
    .from('inscripciones')
    .select('player_id')
    .eq('partido_id', partido_id as string)
    .eq('estado', 'confirmado')

  const validTargets = new Set((confirmados ?? []).map((c: { player_id: string }) => c.player_id))

  const rows: object[] = []
  const seen = new Set<string>()

  for (const v of (votos as Array<Record<string, unknown>>) ?? []) {
    const { categoria, votado_id } = v
    if (typeof categoria !== 'string' || !VALID_CATEGORIAS.has(categoria)) continue
    if (!isUUID(votado_id)) continue
    if (votado_id === user.id) continue
    if (!validTargets.has(votado_id as string)) continue
    if (seen.has(categoria)) continue
    seen.add(categoria)
    rows.push({ club_id: clubId, partido_id, votante_id: user.id, votado_id, categoria })
  }

  if (rows.length === 0) return NextResponse.json({ error: 'No hay votos válidos.' }, { status: 400 })

  const { error } = await admin.from('votos_reconocimiento').insert(rows)
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Ya enviaste tus votos.' }, { status: 409 })
    return NextResponse.json({ error: 'Error guardando votos.' }, { status: 500 })
  }

  await logActivity({
    user_id: user.id,
    accion: 'enviar_votos',
    detalles: { partido_id, categorias: rows.length },
  })

  // ── Auto-close if all confirmed players have now voted ────────────────────
  const { data: todosVotantes } = await admin
    .from('votos_reconocimiento')
    .select('votante_id')
    .eq('partido_id', partido_id as string)

  const uniqueVotantes = new Set((todosVotantes ?? []).map(v => v.votante_id)).size
  const totalConfirmados = confirmados?.length ?? 0

  if (uniqueVotantes >= totalConfirmados && totalConfirmados > 0) {
    await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', partido_id as string)
    const { badges_asignados } = await tallyAndAssign(admin, partido_id as string)
    await logActivity({
      user_id: user.id,
      accion: 'auto_cerrar_votacion',
      detalles: { partido_id, razon: 'todos_votaron', badges_asignados },
    })
    return NextResponse.json({ ok: true, mensaje: '¡Votos enviados! Todos votaron — badges asignados.', auto_cerrado: true })
  }

  return NextResponse.json({ ok: true, mensaje: '¡Votos enviados! Gracias.' })
}

// ── PUT /api/evaluaciones — admin: close voting + assign badges ───────────────
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role, username').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin' && (prof as { role?: string })?.role !== 'superadmin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', partido_id as string)
  const { badges_asignados } = await tallyAndAssign(admin, partido_id as string)

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'cerrar_votacion',
    detalles: { partido_id, badges_asignados },
  })

  return NextResponse.json({
    ok: true,
    mensaje: `Votación cerrada. ${badges_asignados} reconocimientos asignados.`,
    badges_asignados,
  })
}

// ── PATCH /api/evaluaciones — admin: reopen voting + delete badges ────────────
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role, username').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin' && (prof as { role?: string })?.role !== 'superadmin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  await admin.from('partidos').update({ evaluaciones_abiertas: true }).eq('id', partido_id as string)
  await admin.from('player_badges').delete().eq('partido_id', partido_id as string)

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'reabrir_votacion',
    detalles: { partido_id },
  })

  return NextResponse.json({ ok: true, mensaje: 'Evaluaciones reabiertas. Los badges previos de este partido fueron eliminados.' })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'
import { CATEGORIAS } from '@/lib/categorias'

const VALID_CATEGORIAS: Set<string> = new Set(CATEGORIAS.map(c => c.id))

// GET /api/evaluaciones?partido_id=xxx — check status for current user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas, fecha, dia_semana')
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

  // Teammates to vote for
  const { data: compañeros } = await admin
    .from('inscripciones')
    .select('player_id, profiles(id, username, avatar_url, posicion)')
    .eq('partido_id', partido_id)
    .eq('estado', 'confirmado')
    .neq('player_id', user.id)

  return NextResponse.json({
    ok: true,
    abierto: partido.evaluaciones_abiertas,
    yaVoto: (count ?? 0) > 0,
    partido: { fecha: partido.fecha, dia_semana: partido.dia_semana },
    compañeros: (compañeros ?? []).map(c =>
      (c as unknown as { profiles: object }).profiles
    ),
  })
}

// POST /api/evaluaciones — submit votes
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id, votos } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // Match must be open
  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas')
    .eq('id', partido_id)
    .single()

  if (!partido?.evaluaciones_abiertas) {
    return NextResponse.json({ error: 'La votación no está abierta.' }, { status: 403 })
  }

  // Verify participation
  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .eq('estado', 'confirmado')
    .maybeSingle()

  if (!inscripcion) return NextResponse.json({ error: 'No participaste en este partido.' }, { status: 403 })

  // Already voted?
  const { count: yaVoto } = await admin
    .from('votos_reconocimiento')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('votante_id', user.id)

  if ((yaVoto ?? 0) > 0) {
    return NextResponse.json({ error: 'Ya enviaste tus votos.' }, { status: 409 })
  }

  // Fetch confirmed teammates — votado_id must be in this set
  const { data: confirmados } = await admin
    .from('inscripciones')
    .select('player_id')
    .eq('partido_id', partido_id as string)
    .eq('estado', 'confirmado')
    .neq('player_id', user.id)

  const validTargets = new Set((confirmados ?? []).map((c: { player_id: string }) => c.player_id))

  // Build validated rows (one per category, no self-votes, target must be confirmed participant)
  const rows: object[] = []
  const seen = new Set<string>()

  for (const v of (votos as Array<Record<string, unknown>>) ?? []) {
    const { categoria, votado_id } = v
    if (typeof categoria !== 'string' || !VALID_CATEGORIAS.has(categoria)) continue
    if (!isUUID(votado_id)) continue
    if (votado_id === user.id) continue
    if (!validTargets.has(votado_id as string)) continue  // must be confirmed teammate
    if (seen.has(categoria)) continue
    seen.add(categoria)
    rows.push({ partido_id, votante_id: user.id, votado_id, categoria })
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

  return NextResponse.json({ ok: true, mensaje: '¡Votos enviados! Gracias.' })
}

// PUT /api/evaluaciones — admin: close voting + assign badges
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role, username').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // Close voting
  await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', partido_id as string)

  // Fetch all votes for this match
  const { data: votos } = await admin
    .from('votos_reconocimiento')
    .select('votado_id, categoria')
    .eq('partido_id', partido_id as string)

  if (!votos || votos.length === 0) {
    return NextResponse.json({ ok: true, mensaje: 'Votación cerrada. No hay votos registrados.' })
  }

  // Tally: categoria → { player_id → count }
  const tally: Record<string, Record<string, number>> = {}
  for (const v of votos) {
    if (!tally[v.categoria]) tally[v.categoria] = {}
    tally[v.categoria][v.votado_id] = (tally[v.categoria][v.votado_id] ?? 0) + 1
  }

  // Award badge to the player with most votes per category (ties → first in iteration)
  const badges: { player_id: string; categoria: string; emoji: string }[] = []

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

    badges.push({ player_id: winnerId, categoria: cat.id, emoji: cat.emoji })
  }

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'cerrar_votacion',
    detalles: { partido_id, badges_asignados: badges.length },
  })

  return NextResponse.json({
    ok: true,
    mensaje: `Votación cerrada. ${badges.length} reconocimientos asignados.`,
    badges,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID, isIntInRange } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'

// Badge definitions (hardcoded, no extra table needed)
const BADGES_PARTIDO = [
  { id: 'figura', nombre: 'Figura del Partido', emoji: '⭐', campo: 'avg_total' },
  { id: 'kilometros', nombre: 'Kilómetros', emoji: '🏃', campo: 'avg_resistencia' },
  { id: 'tecnico', nombre: 'El Técnico', emoji: '🎯', campo: 'avg_tecnica' },
  { id: 'motor', nombre: 'El Motor', emoji: '💪', campo: 'avg_actitud' },
] as const

// GET /api/evaluaciones?partido_id=xxx — check status for current user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // Check match evaluaciones are open
  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas, fecha, dia_semana')
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  // Check user was confirmed in this match
  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .eq('estado', 'confirmado')
    .maybeSingle()

  if (!inscripcion) return NextResponse.json({ error: 'No estás en la lista de este partido' }, { status: 403 })

  // Check if already submitted
  const { count } = await admin
    .from('evaluaciones')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('evaluador_id', user.id)

  // Get other confirmed players to rate
  const { data: compañeros } = await admin
    .from('inscripciones')
    .select('player_id, profiles(id, username, avatar_url, posicion)')
    .eq('partido_id', partido_id)
    .eq('estado', 'confirmado')
    .neq('player_id', user.id)

  return NextResponse.json({
    ok: true,
    abierto: partido.evaluaciones_abiertas,
    yaEvaluo: (count ?? 0) > 0,
    partido: { fecha: partido.fecha, dia_semana: partido.dia_semana },
    compañeros: (compañeros ?? []).map(c =>
      (c as unknown as { profiles: object }).profiles
    ),
  })
}

// POST /api/evaluaciones — submit evaluations
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id, evaluaciones } = body

  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // Verify match open
  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas')
    .eq('id', partido_id)
    .single()

  if (!partido?.evaluaciones_abiertas) {
    return NextResponse.json({ error: 'Las evaluaciones no están abiertas para este partido.' }, { status: 403 })
  }

  // Verify user was confirmed
  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .eq('estado', 'confirmado')
    .maybeSingle()

  if (!inscripcion) return NextResponse.json({ error: 'No participaste en este partido.' }, { status: 403 })

  // Check not already submitted
  const { count: yaEnvio } = await admin
    .from('evaluaciones')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('evaluador_id', user.id)

  if ((yaEnvio ?? 0) > 0) {
    return NextResponse.json({ error: 'Ya enviaste tus evaluaciones para este partido.' }, { status: 409 })
  }

  // Validate and build rows
  const rows: object[] = []
  for (const ev of (evaluaciones as Array<Record<string, unknown>>) ?? []) {
    const { evaluado_id, resistencia, tecnica, actitud } = ev
    if (!isUUID(evaluado_id)) continue
    if (!isIntInRange(resistencia, 1, 5)) return NextResponse.json({ error: 'Rating de resistencia inválido.' }, { status: 400 })
    if (!isIntInRange(tecnica, 1, 5)) return NextResponse.json({ error: 'Rating de técnica inválido.' }, { status: 400 })
    if (!isIntInRange(actitud, 1, 5)) return NextResponse.json({ error: 'Rating de actitud inválido.' }, { status: 400 })
    // Cannot rate yourself
    if (evaluado_id === user.id) continue

    rows.push({
      partido_id,
      evaluador_id: user.id,
      evaluado_id,
      resistencia,
      tecnica,
      actitud,
    })
  }

  if (rows.length === 0) return NextResponse.json({ error: 'No hay evaluaciones válidas.' }, { status: 400 })

  const { error } = await admin.from('evaluaciones').insert(rows)
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Ya enviaste tus evaluaciones.' }, { status: 409 })
    return NextResponse.json({ error: 'Error guardando evaluaciones.' }, { status: 500 })
  }

  await logActivity({
    user_id: user.id,
    accion: 'enviar_evaluaciones',
    detalles: { partido_id, evaluados: rows.length },
  })

  return NextResponse.json({ ok: true, mensaje: '¡Evaluaciones enviadas! Gracias.' })
}

// PUT /api/evaluaciones — admin: cerrar + calcular badges
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: prof } = await admin.from('profiles').select('role, username').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // Close evaluations
  await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', partido_id as string)

  // Fetch all evaluations for this match
  const { data: evals } = await admin
    .from('evaluaciones')
    .select('evaluado_id, resistencia, tecnica, actitud')
    .eq('partido_id', partido_id as string)

  if (!evals || evals.length === 0) {
    return NextResponse.json({ ok: true, mensaje: 'Evaluaciones cerradas. No hay datos suficientes para badges.' })
  }

  // Aggregate per player
  type PlayerStats = {
    evaluado_id: string
    sum_r: number; sum_t: number; sum_a: number; count: number
    avg_resistencia: number; avg_tecnica: number; avg_actitud: number; avg_total: number
  }
  const statsMap: Record<string, PlayerStats> = {}

  for (const e of evals) {
    if (!statsMap[e.evaluado_id]) {
      statsMap[e.evaluado_id] = { evaluado_id: e.evaluado_id, sum_r: 0, sum_t: 0, sum_a: 0, count: 0, avg_resistencia: 0, avg_tecnica: 0, avg_actitud: 0, avg_total: 0 }
    }
    statsMap[e.evaluado_id].sum_r += e.resistencia
    statsMap[e.evaluado_id].sum_t += e.tecnica
    statsMap[e.evaluado_id].sum_a += e.actitud
    statsMap[e.evaluado_id].count++
  }

  for (const s of Object.values(statsMap)) {
    s.avg_resistencia = s.sum_r / s.count
    s.avg_tecnica = s.sum_t / s.count
    s.avg_actitud = s.sum_a / s.count
    s.avg_total = (s.avg_resistencia + s.avg_tecnica + s.avg_actitud) / 3
  }

  const stats = Object.values(statsMap)
  const badges: { player_id: string; badge_id: string; badge_emoji: string; badge_nombre: string }[] = []

  for (const badge of BADGES_PARTIDO) {
    const best = stats.reduce((prev, curr) =>
      curr[badge.campo] > prev[badge.campo] ? curr : prev
    )
    if (best) {
      badges.push({ player_id: best.evaluado_id, badge_id: badge.id, badge_emoji: badge.emoji, badge_nombre: badge.nombre })
      await admin.from('player_badges').upsert({
        player_id: best.evaluado_id,
        badge_id: badge.id,
        badge_emoji: badge.emoji,
        badge_nombre: badge.nombre,
        partido_id,
      }, { onConflict: 'player_id,badge_id,partido_id' })
    }
  }

  // Update habilidad (running weighted average) for each evaluated player
  for (const s of stats) {
    const { data: current } = await admin
      .from('profiles')
      .select('habilidad, evaluaciones_recibidas')
      .eq('id', s.evaluado_id)
      .single()

    if (current) {
      const oldN = (current as { evaluaciones_recibidas?: number }).evaluaciones_recibidas ?? 0
      const oldH = (current as { habilidad?: number }).habilidad ?? 3.0
      const newH = parseFloat(((oldH * oldN + s.avg_total) / (oldN + 1)).toFixed(2))
      await admin.from('profiles').update({
        habilidad: Math.min(5, Math.max(1, newH)),
        evaluaciones_recibidas: oldN + 1,
      }).eq('id', s.evaluado_id)
    }
  }

  // Career badges: check 🎖️ Capitán (20+ matches) and 🔥 Racha (5+ consecutive)
  const playerIds = [...new Set(stats.map(s => s.evaluado_id))]
  for (const pid of playerIds) {
    // Capitán
    const { count: totalMatches } = await admin
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', pid)
      .eq('estado', 'confirmado')

    if ((totalMatches ?? 0) >= 20) {
      try {
        await admin.from('player_badges').upsert({
          player_id: pid, badge_id: 'capitan', badge_emoji: '🎖️', badge_nombre: 'Capitán',
          partido_id: null,
        }, { onConflict: 'player_id,badge_id' })
      } catch { /* ignore duplicate */ }
    }

    // Racha: last 5 inscriptions all confirmado?
    const { data: recientes } = await admin
      .from('inscripciones')
      .select('estado')
      .eq('player_id', pid)
      .order('created_at', { ascending: false })
      .limit(5)

    if (recientes && recientes.length >= 5 && recientes.every(i => i.estado === 'confirmado')) {
      try {
        await admin.from('player_badges').upsert({
          player_id: pid, badge_id: 'racha', badge_emoji: '🔥', badge_nombre: 'En Racha',
          partido_id: null,
        }, { onConflict: 'player_id,badge_id' })
      } catch { /* ignore duplicate */ }
    }
  }

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'cerrar_evaluaciones',
    detalles: { partido_id, jugadores_evaluados: stats.length, badges_asignados: badges.length },
  })

  return NextResponse.json({
    ok: true,
    mensaje: `Evaluaciones cerradas. ${badges.length} badges asignados.`,
    badges,
  })
}

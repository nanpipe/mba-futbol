import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { calcTier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

// Stat categories and their answer arrays
const STATS = ['res', 'fis', 'def', 'ata', 'tec', 'dis'] as const
type StatKey = typeof STATS[number]

function calcStat(answers: number[]): number {
  if (!Array.isArray(answers) || answers.length !== 5) return 0
  const score = answers.reduce((sum, a) => sum + Math.min(5, Math.max(1, Math.round(a))), 0)
  // Formula: 45 + (score * 2), score range 5–25 → FIFA range 55–95
  return Math.round(45 + score * 2)
}

// GET /api/carta?player_id=xxx — fetch card
// Own card always returned; others only if approved
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const targetId = req.nextUrl.searchParams.get('player_id') ?? user.id
  const admin = createAdminClient()

  const { data: carta } = await admin
    .from('evaluaciones_carta')
    .select('*')
    .eq('player_id', targetId)
    .single()

  if (!carta) return NextResponse.json({ carta: null })

  // Non-owner can only see approved cards
  if (carta.player_id !== user.id && !carta.aprobado) {
    return NextResponse.json({ carta: null })
  }

  return NextResponse.json({ carta })
}

// POST /api/carta — submit or re-submit evaluation form
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  // Verify player is approved
  const { data: playerProf } = await supabase.from('profiles').select('aprobado').eq('id', user.id).single()
  if (!playerProf?.aprobado) return NextResponse.json({ error: 'Tu cuenta aún no ha sido aprobada.' }, { status: 403 })

  // Check if already approved — approved cards can't be re-submitted
  const { data: existing } = await admin
    .from('evaluaciones_carta')
    .select('aprobado, rechazado')
    .eq('player_id', user.id)
    .maybeSingle()

  if (existing?.aprobado) {
    return NextResponse.json({ error: 'Tu carta ya fue aprobada. Contacta al admin para actualizarla.' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { answers, posicion_carta, pierna } = body

  // Validate answers: must have all 6 stats, each with 5 answers in range 1–5
  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'Respuestas inválidas.' }, { status: 400 })
  }
  const answersObj = answers as Record<string, unknown>
  for (const stat of STATS) {
    const arr = answersObj[stat]
    if (!Array.isArray(arr) || arr.length !== 5 || arr.some(v => typeof v !== 'number' || v < 1 || v > 5)) {
      return NextResponse.json({ error: `Respuestas incompletas para: ${stat.toUpperCase()}` }, { status: 400 })
    }
  }

  // Calculate stats
  const statValues: Record<string, number> = {}
  for (const stat of STATS) {
    statValues[`stat_${stat}`] = calcStat(answersObj[stat] as number[])
  }
  const ovrRaw = STATS.reduce((sum, s) => sum + statValues[`stat_${s}`], 0) / STATS.length
  const ovr = Math.round(ovrRaw)
  const tier = calcTier(ovr)

  const row = {
    player_id: user.id,
    answers: answersObj,
    ...statValues,
    ovr,
    tier,
    posicion_carta: typeof posicion_carta === 'string' ? posicion_carta.slice(0, 30) : null,
    pierna: typeof pierna === 'string' ? pierna.slice(0, 20) : null,
    aprobado: false,
    rechazado: false,
    aprobado_por: null,
    aprobado_at: null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await admin
    .from('evaluaciones_carta')
    .upsert(row, { onConflict: 'player_id' })

  if (error) return NextResponse.json({ error: 'Error guardando evaluación.' }, { status: 500 })

  await logActivity({
    user_id: user.id,
    accion: 'enviar_carta',
    detalles: { ovr, tier, posicion_carta },
  })

  return NextResponse.json({ ok: true, ovr, tier, stats: statValues })
}

// PUT /api/carta — admin: approve or reject
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: prof } = await admin.from('profiles').select('role, username').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { player_id, accion, notas_admin, stat_overrides } = body
  if (typeof player_id !== 'string') return NextResponse.json({ error: 'player_id requerido' }, { status: 400 })

  if (accion === 'aprobar') {
    const updates: Record<string, unknown> = {
      aprobado: true,
      rechazado: false,
      aprobado_por: user.id,
      aprobado_at: new Date().toISOString(),
      notas_admin: typeof notas_admin === 'string' ? notas_admin : null,
      updated_at: new Date().toISOString(),
    }

    // Allow admin to override individual stats before approving
    if (stat_overrides && typeof stat_overrides === 'object') {
      const overrides = stat_overrides as Record<string, unknown>
      for (const stat of STATS) {
        const key = `stat_${stat}`
        if (typeof overrides[key] === 'number') {
          updates[key] = Math.min(99, Math.max(45, Math.round(overrides[key] as number)))
        }
      }
      // Recalculate OVR if any stat was overridden
      const { data: current } = await admin
        .from('evaluaciones_carta').select('stat_res,stat_fis,stat_def,stat_ata,stat_tec,stat_dis').eq('player_id', player_id).single()
      if (current) {
        const merged = { ...current, ...updates }
        const ovrRaw = STATS.reduce((sum, s) => sum + ((merged[`stat_${s}`] as number) ?? 0), 0) / STATS.length
        updates.ovr = Math.round(ovrRaw)
        updates.tier = calcTier(updates.ovr as number)
      }
    }

    await admin.from('evaluaciones_carta').update(updates).eq('player_id', player_id)

    await logActivity({
      user_id: user.id,
      username: (prof as { username?: string })?.username,
      accion: 'aprobar_carta',
      detalles: { player_id, notas_admin: updates.notas_admin, stat_overrides },
    })

    return NextResponse.json({ ok: true, mensaje: 'Carta aprobada.' })
  }

  if (accion === 'rechazar') {
    await admin.from('evaluaciones_carta').update({
      rechazado: true,
      aprobado: false,
      notas_admin: typeof notas_admin === 'string' ? notas_admin : null,
      updated_at: new Date().toISOString(),
    }).eq('player_id', player_id)

    await logActivity({
      user_id: user.id,
      username: (prof as { username?: string })?.username,
      accion: 'rechazar_carta',
      detalles: { player_id, notas_admin },
    })

    return NextResponse.json({ ok: true, mensaje: 'Carta rechazada. El jugador podrá volver a enviar.' })
  }

  return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 })
}

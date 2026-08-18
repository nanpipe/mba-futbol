import type { createAdminClient } from '@/lib/supabase/admin'
import { getClubBadges } from '@/lib/categorias'

// ── Player rating (v2) ───────────────────────────────────────────────────────
// Stateful 1–5 rating stored on profiles.habilidad. Everyone starts at 3.0 and
// the number is earned on the field: small per-match deltas, clamped so no
// single game swings it wildly and no one can sit at the top untouched.
//
//   Jugó (activo)            +STEP
//   Ganó                     +STEP   ·  Perdió  −STEP  ·  Empató 0
//   Reconocimiento positivo  +STEP each  (MVP, goleador, defensa, portero, técnico)
//   Reconocimiento negativo  −STEP each  (desaparecido, aizaga, discutidor)
//   No se inscribió (pudo)   −STEP
//   En espera / lesionado    exento (no baja)
//
// Net per match is clamped to ±CAP so a great game is at most +CAP and a bad one
// at most −CAP. Applied once per match via the rating_events ledger (idempotent
// and reversible).

const STEP = 0.02
const CAP_NORMAL = 0.05
const CAP_MINI = 0.10
const MIN_RATING = 1.0
const MAX_RATING = 5.0
const BASE_RATING = 3.0

type Admin = ReturnType<typeof createAdminClient>

/** Badge id → sign, from the club's configured badges. */
async function badgeSigns(admin: Admin, clubId: string): Promise<{ pos: Set<string>; neg: Set<string> }> {
  const badges = await getClubBadges(admin, clubId)
  return {
    pos: new Set(badges.filter(b => b.signo === 'positivo').map(b => b.id)),
    neg: new Set(badges.filter(b => b.signo === 'negativo').map(b => b.id)),
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
const clampRating = (n: number) => Math.max(MIN_RATING, Math.min(MAX_RATING, n))
const clampDelta = (n: number, cap: number) => Math.max(-cap, Math.min(cap, n))

type Team = { nombre: string; color: string }
type Outcome = 'win' | 'draw' | 'loss' | null

interface RatingEventRow {
  club_id: string
  player_id: string
  partido_id: string
  delta: number
  motivos: string[]
  rating_after: number
}

/**
 * Apply the rating deltas for a finished match — exactly once.
 * Idempotent via the rating_events ledger (unique per partido+player). Only runs
 * when the match has a result AND evaluations are closed, so every signal
 * (activity, result, recognitions) is final.
 */
export async function applyMatchRatings(
  admin: Admin,
  partido_id: string
): Promise<{ applied: number; skipped?: string }> {
  const { data: partido } = await admin
    .from('partidos')
    .select('id, club_id, tipo, evaluaciones_abiertas, goles_a, goles_b, puntos_blanco, puntos_negro, puntos_morado')
    .eq('id', partido_id)
    .single()

  if (!partido?.club_id) return { applied: 0, skipped: 'sin_partido' }
  if (partido.evaluaciones_abiertas) return { applied: 0, skipped: 'evaluaciones_abiertas' }

  const esMini = partido.tipo === 'minitorneo'
  const gA = partido.goles_a, gB = partido.goles_b
  const pB = partido.puntos_blanco, pN = partido.puntos_negro, pM = partido.puntos_morado
  const hasResult = esMini
    ? [pB, pN, pM].every(p => typeof p === 'number')
    : typeof gA === 'number' && typeof gB === 'number'
  if (!hasResult) return { applied: 0, skipped: 'sin_resultado' }

  // Already applied?
  const { count: already } = await admin
    .from('rating_events').select('id', { count: 'exact', head: true }).eq('partido_id', partido_id)
  if ((already ?? 0) > 0) return { applied: 0, skipped: 'ya_aplicado' }

  const clubId = partido.club_id as string

  const { data: equipos } = await admin
    .from('equipos').select('id, nombre, color').eq('partido_id', partido_id)
  const equipoById = new Map<string, Team>()
  for (const e of (equipos ?? []) as { id: string; nombre: string; color: string }[]) {
    equipoById.set(e.id, { nombre: e.nombre, color: e.color })
  }
  const equipoIds = [...equipoById.keys()]

  const { pos: POSITIVE_BADGES, neg: NEGATIVE_BADGES } = await badgeSigns(admin, clubId)

  const [insRes, ejRes, badgesRes, profsRes] = await Promise.all([
    admin.from('inscripciones').select('player_id, estado').eq('partido_id', partido_id).in('estado', ['confirmado', 'espera']),
    equipoIds.length
      ? admin.from('equipo_jugadores').select('player_id, equipo_id').in('equipo_id', equipoIds)
      : Promise.resolve({ data: [] as { player_id: string; equipo_id: string }[] }),
    admin.from('player_badges').select('player_id, badge_id').eq('partido_id', partido_id),
    admin.from('profiles').select('id, habilidad, aprobado, baneado').eq('club_id', clubId),
  ])

  const confirmados = new Set<string>()
  const espera = new Set<string>()
  for (const i of (insRes.data ?? []) as { player_id: string; estado: string }[]) {
    if (i.estado === 'confirmado') confirmados.add(i.player_id)
    else if (i.estado === 'espera') espera.add(i.player_id)
  }

  const teamByPlayer = new Map<string, Team>()
  for (const ej of (ejRes.data ?? []) as { player_id: string; equipo_id: string }[]) {
    const t = equipoById.get(ej.equipo_id)
    if (t) teamByPlayer.set(ej.player_id, t)
  }

  const badgePos = new Map<string, number>()
  const badgeNeg = new Map<string, number>()
  for (const b of (badgesRes.data ?? []) as { player_id: string; badge_id: string }[]) {
    if (POSITIVE_BADGES.has(b.badge_id)) badgePos.set(b.player_id, (badgePos.get(b.player_id) ?? 0) + 1)
    else if (NEGATIVE_BADGES.has(b.badge_id)) badgeNeg.set(b.player_id, (badgeNeg.get(b.player_id) ?? 0) + 1)
  }

  const ratingById = new Map<string, number>()
  const eligible: string[] = []
  for (const p of (profsRes.data ?? []) as { id: string; habilidad: number | null; aprobado: boolean; baneado: boolean }[]) {
    ratingById.set(p.id, typeof p.habilidad === 'number' ? p.habilidad : BASE_RATING)
    if (p.aprobado && !p.baneado) eligible.push(p.id)
  }

  const cap = esMini ? CAP_MINI : CAP_NORMAL

  const outcome = (team: Team | undefined): Outcome => {
    if (!team) return null
    if (esMini) {
      const pts: Record<string, number> = {
        blanco: pB as number, negro: pN as number, morado: pM as number,
      }
      const own = pts[team.color]
      if (typeof own !== 'number') return null
      const max = Math.max(pB as number, pN as number, pM as number)
      if (own < max) return 'loss'
      const atMax = [pB, pN, pM].filter(p => p === max).length
      return atMax === 1 ? 'win' : 'draw'
    }
    const a = gA as number, b = gB as number
    if (team.nombre === 'A') return a === b ? 'draw' : a > b ? 'win' : 'loss'
    if (team.nombre === 'B') return b === a ? 'draw' : b > a ? 'win' : 'loss'
    return null
  }

  const events: RatingEventRow[] = []
  const updates: { id: string; rating: number }[] = []

  for (const id of eligible) {
    if (espera.has(id)) continue // exento

    let raw = 0
    const motivos: string[] = []

    if (confirmados.has(id)) {
      raw += STEP
      motivos.push('activo')

      const res = outcome(teamByPlayer.get(id))
      if (res === 'win') { raw += STEP; motivos.push('ganó') }
      else if (res === 'loss') { raw -= STEP; motivos.push('perdió') }
      else if (res === 'draw') { motivos.push('empató') }

      const pos = badgePos.get(id) ?? 0
      const neg = badgeNeg.get(id) ?? 0
      if (pos) { raw += STEP * pos; motivos.push(`reconocimiento+ ×${pos}`) }
      if (neg) { raw -= STEP * neg; motivos.push(`reconocimiento- ×${neg}`) }
    } else {
      raw -= STEP
      motivos.push('inactivo')
    }

    const delta = round3(clampDelta(raw, cap))
    const old = ratingById.get(id) ?? BASE_RATING
    const rating_after = clampRating(round3(old + delta))

    events.push({ club_id: clubId, player_id: id, partido_id, delta, motivos, rating_after })
    if (rating_after !== old) updates.push({ id, rating: rating_after })
  }

  if (events.length === 0) return { applied: 0, skipped: 'sin_jugadores' }

  await admin.from('rating_events').insert(events)
  await Promise.all(
    updates.map(u => admin.from('profiles').update({ habilidad: u.rating }).eq('id', u.id))
  )

  return { applied: events.length }
}

/**
 * Reverse a match's applied rating deltas and clear its ledger rows. Used when
 * an admin reopens voting or re-enters a result, so re-closing recomputes fresh.
 */
export async function revertMatchRatings(
  admin: Admin,
  partido_id: string
): Promise<{ reverted: number }> {
  const { data: evs } = await admin
    .from('rating_events').select('player_id, delta').eq('partido_id', partido_id)
  if (!evs || evs.length === 0) return { reverted: 0 }

  const playerIds = evs.map(e => (e as { player_id: string }).player_id)
  const { data: profs } = await admin
    .from('profiles').select('id, habilidad').in('id', playerIds)
  const current = new Map<string, number>()
  for (const p of (profs ?? []) as { id: string; habilidad: number | null }[]) {
    current.set(p.id, typeof p.habilidad === 'number' ? p.habilidad : BASE_RATING)
  }

  await Promise.all(
    (evs as { player_id: string; delta: number }[]).map(e => {
      const next = clampRating(round3((current.get(e.player_id) ?? BASE_RATING) - e.delta))
      return admin.from('profiles').update({ habilidad: next }).eq('id', e.player_id)
    })
  )
  await admin.from('rating_events').delete().eq('partido_id', partido_id)

  return { reverted: evs.length }
}

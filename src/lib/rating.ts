import type { createAdminClient } from '@/lib/supabase/admin'
import { CATEGORIAS } from '@/lib/categorias'

// ── Player rating (Phase 2) ──────────────────────────────────────────────────
// rating = card OVR (neutral 70 if none) + recent-form modifier, where the
// modifier blends: badge weights (peso), peer thumbs, and match results.
// Window is rolling so the rating reflects current form, no monthly batch.

const NEUTRAL_OVR = 70
const WINDOW_DAYS = 60
const MOD_CAP = 15            // clamp the form modifier so OVR stays dominant
const WIN_WEIGHT = 2          // each net win contributes this to the modifier

const PESO_BY_ID: Record<string, number> =
  Object.fromEntries(CATEGORIAS.map(c => [c.id, c.peso]))

export interface PlayerRating {
  ovr: number
  badgeScore: number
  thumbScore: number
  winScore: number
  rating: number
  stars: number
}

/** OVR-scale number → ★ stars (÷20, 1 decimal). */
export function ratingToStars(rating: number): number {
  return Math.round((rating / 20) * 10) / 10
}

type Admin = ReturnType<typeof createAdminClient>

/**
 * Compute current ratings for a set of players from real signals.
 * Single source of truth — used by the team balancer and any rating display.
 */
export async function computeRatings(
  admin: Admin,
  playerIds: string[]
): Promise<Map<string, PlayerRating>> {
  const map = new Map<string, PlayerRating>()
  if (!playerIds.length) return map

  const sinceISO = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()
  const sinceDate = sinceISO.split('T')[0]

  const [cartasRes, badgesRes, thumbsRes, equiposJRes] = await Promise.all([
    admin.from('evaluaciones_carta').select('player_id, ovr, aprobado').in('player_id', playerIds),
    admin.from('player_badges').select('player_id, badge_id').in('player_id', playerIds).gte('earned_at', sinceISO),
    admin.from('player_thumbs').select('votado_id, value').in('votado_id', playerIds).gte('created_at', sinceISO),
    admin.from('equipo_jugadores').select('player_id, equipos(nombre, partido_id)').in('player_id', playerIds),
  ])

  // OVR (self card, approved only)
  const ovrMap = new Map<string, number>()
  for (const c of (cartasRes.data ?? []) as { player_id: string; ovr: number | null; aprobado: boolean }[]) {
    if (c.aprobado && typeof c.ovr === 'number') ovrMap.set(c.player_id, c.ovr)
  }

  // Badge weights (rolling)
  const badgeMap = new Map<string, number>()
  for (const b of (badgesRes.data ?? []) as { player_id: string; badge_id: string }[]) {
    badgeMap.set(b.player_id, (badgeMap.get(b.player_id) ?? 0) + (PESO_BY_ID[b.badge_id] ?? 0))
  }

  // Peer thumbs (rolling)
  const thumbMap = new Map<string, number>()
  for (const t of (thumbsRes.data ?? []) as { votado_id: string; value: number }[]) {
    thumbMap.set(t.votado_id, (thumbMap.get(t.votado_id) ?? 0) + t.value)
  }

  // Win record (rolling) — needs partido results, fetched in a second pass
  const playerTeams: { player_id: string; nombre: string; partido_id: string }[] = []
  const partidoIds = new Set<string>()
  for (const ej of (equiposJRes.data ?? []) as unknown as { player_id: string; equipos: { nombre: string; partido_id: string } | null }[]) {
    if (!ej.equipos?.partido_id) continue
    playerTeams.push({ player_id: ej.player_id, nombre: ej.equipos.nombre, partido_id: ej.equipos.partido_id })
    partidoIds.add(ej.equipos.partido_id)
  }
  const winMap = new Map<string, number>()
  if (partidoIds.size) {
    const { data: partidos } = await admin
      .from('partidos')
      .select('id, goles_a, goles_b, fecha')
      .in('id', [...partidoIds])
      .gte('fecha', sinceDate)
    const pById = new Map<string, { goles_a: number | null; goles_b: number | null }>()
    for (const p of (partidos ?? []) as { id: string; goles_a: number | null; goles_b: number | null; fecha: string }[]) {
      pById.set(p.id, { goles_a: p.goles_a, goles_b: p.goles_b })
    }
    for (const pt of playerTeams) {
      const p = pById.get(pt.partido_id)
      if (!p || p.goles_a == null || p.goles_b == null) continue
      const draw = p.goles_a === p.goles_b
      const won = (pt.nombre === 'A' && p.goles_a > p.goles_b) || (pt.nombre === 'B' && p.goles_b > p.goles_a)
      winMap.set(pt.player_id, (winMap.get(pt.player_id) ?? 0) + (won ? 1 : draw ? 0 : -0.5))
    }
  }

  for (const id of playerIds) {
    const ovr = ovrMap.get(id) ?? NEUTRAL_OVR
    const badgeScore = badgeMap.get(id) ?? 0
    const thumbScore = thumbMap.get(id) ?? 0
    const winScore = winMap.get(id) ?? 0
    const rawMod = badgeScore + thumbScore + winScore * WIN_WEIGHT
    const mod = Math.max(-MOD_CAP, Math.min(MOD_CAP, rawMod))
    const rating = ovr + mod
    map.set(id, { ovr, badgeScore, thumbScore, winScore, rating, stars: ratingToStars(rating) })
  }
  return map
}

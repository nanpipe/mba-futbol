import type { createAdminClient } from '@/lib/supabase/admin'

// Post-match peer recognitions ("badges"). Configurable per club and stored in
// app_settings under BADGES_SETTING_KEY. `signo` feeds the player rating:
//   positivo → sube el rating, negativo → baja, neutral → no afecta.

export type BadgeSigno = 'positivo' | 'negativo' | 'neutral'

export interface Badge {
  id: string
  emoji: string
  nombre: string
  signo: BadgeSigno
}

export const BADGES_SETTING_KEY = 'badges'

// Used when a club hasn't customized its badges.
export const DEFAULT_BADGES: Badge[] = [
  { id: 'mvp',          emoji: '🏆', nombre: 'MVP del Partido',   signo: 'positivo' },
  { id: 'goleador',     emoji: '⚽', nombre: 'Goleador',           signo: 'positivo' },
  { id: 'defensa',      emoji: '🛡️', nombre: 'Mejor Defensa',      signo: 'positivo' },
  { id: 'portero',      emoji: '🧤', nombre: 'Mejor Portero',      signo: 'positivo' },
  { id: 'tecnico',      emoji: '🎯', nombre: 'El Técnico',         signo: 'positivo' },
  { id: 'desaparecido', emoji: '💤', nombre: 'Desaparecido',       signo: 'negativo' },
  { id: 'aizaga',       emoji: '🥅', nombre: 'Aizaga del Partido', signo: 'negativo' },
  { id: 'discutidor',   emoji: '🗣️', nombre: 'Más Discutidor',     signo: 'negativo' },
]

const VALID_SIGNOS = new Set<BadgeSigno>(['positivo', 'negativo', 'neutral'])

/** Read a club's configured badges from app_settings (falls back to defaults). */
export async function getClubBadges(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string
): Promise<Badge[]> {
  const { data } = await admin
    .from('app_settings').select('value').eq('club_id', clubId).eq('key', BADGES_SETTING_KEY).maybeSingle()
  return parseBadges((data as { value?: unknown } | null)?.value)
}

/** Parse a club's configured badges (app_settings value); fall back to defaults. */
export function parseBadges(value: unknown): Badge[] {
  if (!Array.isArray(value)) return DEFAULT_BADGES
  const out: Badge[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const nombre = typeof r.nombre === 'string' ? r.nombre.trim() : ''
    const emoji = typeof r.emoji === 'string' ? r.emoji.trim() : ''
    const signo: BadgeSigno = typeof r.signo === 'string' && VALID_SIGNOS.has(r.signo as BadgeSigno)
      ? (r.signo as BadgeSigno)
      : 'neutral'
    if (!id || !nombre || seen.has(id)) continue
    seen.add(id)
    out.push({ id, emoji: emoji || '🏅', nombre: nombre.slice(0, 40), signo })
  }
  return out.length ? out : DEFAULT_BADGES
}

/** Validate + normalize an incoming badges array for storage (admin write). */
export function sanitizeBadges(value: unknown): Badge[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return null
  const out: Badge[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim().slice(0, 40) : ''
    const nombre = typeof r.nombre === 'string' ? r.nombre.trim().slice(0, 40) : ''
    const emoji = typeof r.emoji === 'string' ? r.emoji.trim().slice(0, 8) : ''
    const signo: BadgeSigno = typeof r.signo === 'string' && VALID_SIGNOS.has(r.signo as BadgeSigno)
      ? (r.signo as BadgeSigno)
      : 'neutral'
    if (!id || !nombre || seen.has(id)) return null
    seen.add(id)
    out.push({ id, emoji: emoji || '🏅', nombre, signo })
  }
  return out
}

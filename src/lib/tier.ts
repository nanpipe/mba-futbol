// ── Rating tiers ─────────────────────────────────────────────────────────────
// Tiers are derived from the 1–5 rating (profiles.habilidad). The score is the
// source of truth; the tier is just its label + look. Configurable per club and
// stored in app_settings under TIERS_SETTING_KEY.

export interface RatingTier {
  min: number
  label: string
  emoji: string
  bg: string
  text: string
}

export const TIERS_SETTING_KEY = 'rating_tiers'

// Gradient presets a club can pick from (id → look). Keeps stored config small
// and avoids letting admins inject arbitrary CSS.
export const TIER_LOOKS: Record<string, { bg: string; text: string; label: string }> = {
  morado:  { bg: 'linear-gradient(145deg, #1a0533, #4c1d95, #7c3aed, #a855f7)',          text: '#f3e8ff', label: 'Morado' },
  naranja: { bg: 'linear-gradient(145deg, #431407, #9a3412, #ea580c, #fb923c)',          text: '#fff7ed', label: 'Naranja' },
  oro:     { bg: 'linear-gradient(145deg, #713f12, #a16207, #ca8a04, #eab308, #fde047)', text: '#1c1917', label: 'Oro' },
  plata:   { bg: 'linear-gradient(145deg, #1e293b, #334155, #64748b, #94a3b8)',          text: '#f1f5f9', label: 'Plata' },
  bronce:  { bg: 'linear-gradient(145deg, #292524, #57534e, #a8a29e, #d6d3d1)',          text: '#1c1917', label: 'Bronce' },
  humo:    { bg: 'linear-gradient(145deg, #1c1917, #44403c, #78716c)',                   text: '#e7e5e4', label: 'Humo' },
  verde:   { bg: 'linear-gradient(145deg, #052e16, #166534, #16a34a, #4ade80)',          text: '#f0fdf4', label: 'Verde' },
  azul:    { bg: 'linear-gradient(145deg, #082f49, #0c4a6e, #0284c7, #38bdf8)',          text: '#f0f9ff', label: 'Azul' },
  rojo:    { bg: 'linear-gradient(145deg, #450a0a, #991b1b, #dc2626, #f87171)',          text: '#fef2f2', label: 'Rojo' },
}

export const DEFAULT_LOOK = 'humo'

export interface TierConfig {
  min: number
  label: string
  emoji: string
  look: string
}

// Ordered high → low. First tier whose `min` the rating meets wins.
export const DEFAULT_TIERS: TierConfig[] = [
  { min: 4.5, label: 'ELITE',        emoji: '🔥', look: 'morado' },
  { min: 4.0, label: 'CRACK',        emoji: '⭐', look: 'naranja' },
  { min: 3.5, label: 'TITULAR',      emoji: '💪', look: 'oro' },
  { min: 3.0, label: 'PROMEDIO',     emoji: '⚽', look: 'plata' },
  { min: 2.0, label: 'CADETE',       emoji: '🌱', look: 'bronce' },
  { min: 1.0, label: 'BANCA ETERNA', emoji: '😴', look: 'humo' },
]

const toTier = (t: TierConfig): RatingTier => {
  const look = TIER_LOOKS[t.look] ?? TIER_LOOKS[DEFAULT_LOOK]
  return { min: t.min, label: t.label, emoji: t.emoji, bg: look.bg, text: look.text }
}

/** Parse a club's configured tiers (app_settings value); fall back to defaults. */
export function parseTiers(value: unknown): TierConfig[] {
  if (!Array.isArray(value)) return DEFAULT_TIERS
  const out: TierConfig[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const min = typeof r.min === 'number' ? r.min : parseFloat(String(r.min))
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    if (isNaN(min) || !label) continue
    out.push({
      min: Math.max(1, Math.min(5, min)),
      label: label.slice(0, 30),
      emoji: typeof r.emoji === 'string' && r.emoji.trim() ? r.emoji.trim().slice(0, 8) : '⚽',
      look: typeof r.look === 'string' && TIER_LOOKS[r.look] ? r.look : DEFAULT_LOOK,
    })
  }
  if (!out.length) return DEFAULT_TIERS
  return out.sort((a, b) => b.min - a.min)
}

/** Validate + normalize an incoming tiers array for storage (admin write). */
export function sanitizeTiers(value: unknown): TierConfig[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return null
  const out: TierConfig[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const min = typeof r.min === 'number' ? r.min : parseFloat(String(r.min))
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 30) : ''
    if (isNaN(min) || min < 1 || min > 5 || !label) return null
    out.push({
      min: Math.round(min * 100) / 100,
      label,
      emoji: typeof r.emoji === 'string' && r.emoji.trim() ? r.emoji.trim().slice(0, 8) : '⚽',
      look: typeof r.look === 'string' && TIER_LOOKS[r.look] ? r.look : DEFAULT_LOOK,
    })
  }
  const sorted = out.sort((a, b) => b.min - a.min)
  // The lowest band must cover the floor so every rating maps to a tier.
  sorted[sorted.length - 1].min = 1
  return sorted
}

/** Resolve the tier for a rating, given a club's config (or defaults). */
export function ratingTier(rating: number, tiers: TierConfig[] = DEFAULT_TIERS): RatingTier {
  const list = tiers.length ? tiers : DEFAULT_TIERS
  const found = list.find(t => rating >= t.min) ?? list[list.length - 1]
  return toTier(found)
}

export function ratingTierStyle(
  rating: number,
  tiers: TierConfig[] = DEFAULT_TIERS
): { bg: string; text: string; label: string; emoji: string } {
  const t = ratingTier(rating, tiers)
  return { bg: t.bg, text: t.text, label: t.label, emoji: t.emoji }
}

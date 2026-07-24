// ── Rating tiers ─────────────────────────────────────────────────────────────
// Tiers are derived from the 1–5 rating (profiles.habilidad). The score is the
// source of truth; the tier is just its label + look. Reuses the old card
// gradients so the visual keeps its flair.

export interface RatingTier {
  min: number
  label: string
  emoji: string
  bg: string
  text: string
}

// Ordered high → low. First tier whose `min` the rating meets wins.
const TIERS: RatingTier[] = [
  { min: 4.5, label: 'ELITE',        emoji: '🔥', bg: 'linear-gradient(145deg, #1a0533, #4c1d95, #7c3aed, #a855f7)',          text: '#f3e8ff' },
  { min: 4.0, label: 'CRACK',        emoji: '⭐', bg: 'linear-gradient(145deg, #431407, #9a3412, #ea580c, #fb923c)',          text: '#fff7ed' },
  { min: 3.5, label: 'TITULAR',      emoji: '💪', bg: 'linear-gradient(145deg, #713f12, #a16207, #ca8a04, #eab308, #fde047)', text: '#1c1917' },
  { min: 3.0, label: 'PROMEDIO',     emoji: '⚽', bg: 'linear-gradient(145deg, #1e293b, #334155, #64748b, #94a3b8)',          text: '#f1f5f9' },
  { min: 2.0, label: 'CADETE',       emoji: '🌱', bg: 'linear-gradient(145deg, #292524, #57534e, #a8a29e, #d6d3d1)',          text: '#1c1917' },
  { min: 1.0, label: 'BANCA ETERNA', emoji: '😴', bg: 'linear-gradient(145deg, #1c1917, #44403c, #78716c)',                   text: '#e7e5e4' },
]

export function ratingTier(rating: number): RatingTier {
  return TIERS.find(t => rating >= t.min) ?? TIERS[TIERS.length - 1]
}

export function ratingTierStyle(rating: number): { bg: string; text: string; label: string; emoji: string } {
  const t = ratingTier(rating)
  return { bg: t.bg, text: t.text, label: t.label, emoji: t.emoji }
}

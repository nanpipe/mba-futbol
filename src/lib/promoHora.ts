// The club's "promo hour" — when guests get promoted, the team draft is built,
// and the home screen switches from last match's recap to today's match.
// Shared so the cron and the UI can never disagree about when that is.

export const PROMO_HOUR_DEFAULT = 14 // 2 PM
const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000 // UTC-5

/**
 * Parse the stored setting ("2:00 PM", "14:00", "2 pm") into an hour 0–23.
 * Falls back to 2 PM for anything unparseable — including the empty string,
 * which `?? default` would let through.
 */
export function parsePromoHour(raw: unknown): number {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return PROMO_HOUR_DEFAULT

  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i)
  if (!m) return PROMO_HOUR_DEFAULT

  const n = parseInt(m[1], 10)
  if (isNaN(n) || n < 0 || n > 23) return PROMO_HOUR_DEFAULT

  const sufijo = m[3]?.toUpperCase()
  // No AM/PM given: it's already 24-hour, take it as written.
  if (!sufijo) return n
  if (sufijo === 'AM') return n % 12
  return (n % 12) + 12
}

/** Current hour (0–23) in Colombia. */
export function horaColombia(now: Date = new Date()): number {
  return new Date(now.getTime() - COLOMBIA_OFFSET_MS).getUTCHours()
}

/** Today's calendar date (YYYY-MM-DD) in Colombia, not UTC. */
export function fechaColombia(now: Date = new Date()): string {
  return new Date(now.getTime() - COLOMBIA_OFFSET_MS).toISOString().split('T')[0]
}

/**
 * True once the promo hour has arrived on the day of `fechaPartido` — the point
 * where the app stops looking backwards at the last match and focuses on today's.
 */
export function esHoraDePartido(
  fechaPartido: string | null | undefined,
  promoRaw: unknown,
  now: Date = new Date()
): boolean {
  if (!fechaPartido) return false
  return fechaPartido === fechaColombia(now) && horaColombia(now) >= parsePromoHour(promoRaw)
}

/**
 * Simple in-memory rate limiter.
 * Resets on server cold start. Sufficient for low-traffic club app.
 * Key: typically IP address. Window: sliding, in ms.
 */

interface RateLimitEntry {
  count: number
  windowStart: number
}

const store = new Map<string, RateLimitEntry>()

// Cleanup old entries every 10 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > 10 * 60 * 1000) store.delete(key)
  }
}, 10 * 60 * 1000)

/**
 * Returns true if request should be blocked (rate limit exceeded).
 * @param key      Unique key (e.g., IP or `${ip}:${route}`)
 * @param limit    Max requests allowed in window
 * @param windowMs Window duration in milliseconds
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: now })
    return false
  }

  if (entry.count >= limit) return true

  entry.count++
  return false
}

/**
 * Extract client IP from Next.js request headers.
 * Prefers x-forwarded-for (set by Vercel/proxies).
 */
export function getClientIp(req: Request): string {
  // x-real-ip first, then the LAST x-forwarded-for entry — that one is appended
  // by our own proxy. The first entry is whatever the caller sent, so reading it
  // let anyone reset their own rate limit by rotating a header.
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return 'unknown'
}

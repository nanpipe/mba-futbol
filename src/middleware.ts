import { NextRequest, NextResponse } from 'next/server'

// ─── Rate limiter (in-memory, per edge worker instance) ─────────────────────
// Resets on cold starts — acceptable tradeoff for a small-scale app.
// For Redis-backed limiting, replace with @vercel/kv or Upstash.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const RATE_WINDOWS: Record<string, { limit: number; windowMs: number }> = {
  // Auth-adjacent / expensive operations
  '/api/inscripciones': { limit: 20, windowMs: 60_000 },
  '/api/push/subscribe': { limit: 10, windowMs: 60_000 },
  '/api/push/test':      { limit: 5,  windowMs: 60_000 },
  '/api/admin':          { limit: 60, windowMs: 60_000 },
  '/api/notify':         { limit: 10, windowMs: 60_000 },
  // Public pages — generous
  default:               { limit: 120, windowMs: 60_000 },
}

function getRateConfig(pathname: string) {
  for (const [prefix, config] of Object.entries(RATE_WINDOWS)) {
    if (prefix !== 'default' && pathname.startsWith(prefix)) return config
  }
  return RATE_WINDOWS.default
}

function checkRateLimit(ip: string, pathname: string): boolean {
  const key = `${ip}:${pathname.split('/').slice(0, 4).join('/')}`
  const now = Date.now()
  const config = getRateConfig(pathname)
  const entry = rateLimitMap.get(key)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + config.windowMs })
    return true
  }

  if (entry.count >= config.limit) return false
  entry.count++
  return true
}

// ─── Allowed origins ────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mba-futbol.vercel.app',
  // Allow localhost in dev
  'http://localhost:3000',
  'http://localhost:3001',
])

function corsCheck(req: NextRequest, pathname: string): Response | null {
  // Only enforce on API routes
  if (!pathname.startsWith('/api/')) return null

  const origin = req.headers.get('origin')
  // No origin header = server-to-server call = allow (fetch from same server)
  if (!origin) return null
  // Origin matches our domain = allow
  if (ALLOWED_ORIGINS.has(origin)) return null

  // Block everything else
  return new NextResponse(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Middleware ──────────────────────────────────────────────────────────────
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Skip static assets and Next.js internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(ico|png|jpg|svg|webmanifest|js|css|woff2?)$/)
  ) {
    return NextResponse.next()
  }

  // ── CORS check ────────────────────────────────────────────────────────────
  const corsBlocked = corsCheck(req, pathname)
  if (corsBlocked) return corsBlocked

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'

  if (!checkRateLimit(ip, pathname)) {
    return new NextResponse(JSON.stringify({ error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ─── Rate limiter (in-memory, resets per cold start) ────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const RATE_WINDOWS: Record<string, { limit: number; windowMs: number }> = {
  // Auth pages — tight to slow brute-force / enumeration
  '/login':              { limit: 10,  windowMs: 600_000  }, // 10 per 10 min
  '/registro':           { limit: 5,   windowMs: 3_600_000 }, // 5 per hour
  '/recuperar':          { limit: 5,   windowMs: 3_600_000 }, // 5 per hour
  // API routes
  '/api/inscripciones':  { limit: 20,  windowMs: 60_000 },
  '/api/push/subscribe': { limit: 10,  windowMs: 60_000 },
  '/api/push/test':      { limit: 5,   windowMs: 60_000 },
  '/api/admin':          { limit: 60,  windowMs: 60_000 },
  '/api/notify':         { limit: 10,  windowMs: 60_000 },
  '/api/perfil':         { limit: 15,  windowMs: 60_000 },
  '/api/invitados':      { limit: 20,  windowMs: 60_000 },
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

// ─── Allowed origins for API routes ─────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mba-futbol.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
])

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // ── CORS: block API requests from unexpected origins ──────────────────────
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin')
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new NextResponse(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // x-real-ip is set by Vercel to the true client IP (not spoofable).
  // x-forwarded-for first value is client-controlled; use it only as fallback.
  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ??
    '127.0.0.1'

  if (!checkRateLimit(ip, pathname)) {
    return new NextResponse(
      JSON.stringify({ error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      }
    )
  }

  // ── Supabase session refresh ──────────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

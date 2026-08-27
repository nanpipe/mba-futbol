import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ─── Constants ───────────────────────────────────────────────────────────────
const MBAFC_CLUB_ID = 'a0000000-0000-0000-0000-000000000001'
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'mba-futbol.app'

const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mba-futbol.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
])

// ─── Rate limiter (in-memory, resets per cold start) ─────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const RATE_WINDOWS: Record<string, { limit: number; windowMs: number }> = {
  '/login':              { limit: 10,  windowMs: 600_000  },
  '/registro':           { limit: 5,   windowMs: 3_600_000 },
  '/recuperar':          { limit: 5,   windowMs: 3_600_000 },
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

// ─── Club resolver (5-min cache) ─────────────────────────────────────────────
const slugCache = new Map<string, { id: string; nombre: string; slug: string; subscription_status: string; expires: number }>()

async function resolveClubBySlug(slug: string) {
  const cached = slugCache.get(slug)
  if (cached && Date.now() < cached.expires) return cached

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data } = await supabase
    .from('clubs')
    .select('id, nombre, slug, subscription_status')
    .eq('slug', slug)
    .single()

  if (!data) return null

  const entry = { ...data, expires: Date.now() + 5 * 60 * 1000 }
  slugCache.set(slug, entry)
  return entry
}

const CLUB_HEADERS = ['x-club-id', 'x-club-slug', 'x-club-nombre', 'x-club-status']

// ─── Main middleware ──────────────────────────────────────────────────────────
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const hostname = request.headers.get('host') ?? ''

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

  // ── Club resolution from subdomain ───────────────────────────────────────
  // Resolved BEFORE the response is built, so the values can be forwarded to
  // route handlers as REQUEST headers. Setting them on the response only sends
  // them to the browser — handlers never saw them, so getClubId(req) was
  // reading whatever the caller chose to send.
  let club: { id: string; slug: string; nombre?: string; subscription_status?: string }

  if (hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1')) {
    club = { id: MBAFC_CLUB_ID, slug: 'mbafc' }
  } else {
    const escapedRoot = ROOT_DOMAIN.replace(/\./g, '\\.')
    const subMatch = hostname.match(new RegExp(`^([a-z0-9-]+)\\.${escapedRoot}$`))
    if (subMatch && subMatch[1] !== 'www') {
      const resolved = await resolveClubBySlug(subMatch[1])
      if (!resolved) return new NextResponse('Club not found', { status: 404 })
      club = resolved
    } else {
      // Root domain or preview URL — default tenant.
      club = { id: MBAFC_CLUB_ID, slug: 'mbafc' }
    }
  }

  // Strip anything the caller sent under these names before setting our own.
  // Without this a request could carry x-club-id and read another tenant.
  const reqHeaders = new Headers(request.headers)
  for (const h of CLUB_HEADERS) reqHeaders.delete(h)
  reqHeaders.set('x-club-id', club.id)
  reqHeaders.set('x-club-slug', club.slug)
  if (club.nombre) reqHeaders.set('x-club-nombre', club.nombre)
  if (club.subscription_status) reqHeaders.set('x-club-status', club.subscription_status)

  // ── Supabase session refresh ──────────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request: { headers: reqHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request: { headers: reqHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.getUser()

  supabaseResponse.cookies.set('__club_id', club.id, { path: '/', sameSite: 'lax' })
  supabaseResponse.cookies.set('__club_slug', club.slug, { path: '/', sameSite: 'lax' })

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon-|manifest\\.json|sw\\.js|.*\\.png|.*\\.svg).*)',],
}

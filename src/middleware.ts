import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const MBAFC_CLUB_ID = 'a0000000-0000-0000-0000-000000000001'
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'mba-futbol.app'

// Edge-compatible in-memory cache: slug → club row (5 min TTL)
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

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const hostname = req.headers.get('host') ?? ''

  // ── Local dev: always use MBA FC ──────────────────────────────────────────
  if (hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1')) {
    res.headers.set('x-club-id', MBAFC_CLUB_ID)
    res.headers.set('x-club-slug', 'mbafc')
    res.cookies.set('__club_id', MBAFC_CLUB_ID, { path: '/', sameSite: 'lax' })
    return res
  }

  // ── Production: extract subdomain ──────────────────────────────────────────
  // mbafc.mba-futbol.app → slug = 'mbafc'
  const escapedRoot = ROOT_DOMAIN.replace(/\./g, '\\.')
  const subMatch = hostname.match(new RegExp(`^([a-z0-9-]+)\\.${escapedRoot}$`))

  if (!subMatch) {
    // Root domain or www — landing page, no club context needed
    return res
  }

  const slug = subMatch[1]
  if (slug === 'www') return res

  const club = await resolveClubBySlug(slug)

  if (!club) {
    return new NextResponse('Club not found', { status: 404 })
  }

  // ── Inject club context into headers + cookie ──────────────────────────────
  res.headers.set('x-club-id', club.id)
  res.headers.set('x-club-slug', club.slug)
  res.headers.set('x-club-nombre', club.nombre)
  res.headers.set('x-club-status', club.subscription_status)

  // Cookie readable by client components (httpOnly: false)
  res.cookies.set('__club_id', club.id, { path: '/', sameSite: 'lax' })
  res.cookies.set('__club_slug', club.slug, { path: '/', sameSite: 'lax' })

  return res
}

export const config = {
  matcher: [
    // Skip static assets and Next.js internals
    '/((?!_next/static|_next/image|favicon\\.ico|icon-|manifest\\.json|sw\\.js|.*\\.png|.*\\.svg).*)',
  ],
}

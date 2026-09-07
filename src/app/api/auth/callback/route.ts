import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  // Must be a site-relative path. Anything else (including "//host" and
  // "@host", which make the origin a userinfo prefix) redirects off-site.
  const nextRaw = searchParams.get('next') ?? '/'
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Append recovery=true so the destination page knows this is a password reset
      const destination = next.includes('actualizar-password')
        ? `${next}${next.includes('?') ? '&' : '?'}recovery=true`
        : next
      return NextResponse.redirect(`${origin}${destination}`)
    }
  }

  return NextResponse.redirect(`${origin}/`)
}

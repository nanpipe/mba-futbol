import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientIp } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/check-registro
 * Server-side pre-registration check:
 *   1. Reads caller IP from request headers (can't be spoofed by client)
 *   2. Checks if that IP already has a registered profile
 * Returns: { ip, blocked: false } or { ip, blocked: true, existingUsername }
 * Called by the registro page before creating the Supabase auth user.
 */
export async function POST(req: NextRequest) {
  // Proxy-set IP. The first x-forwarded-for entry is caller-controlled, which
  // made this "one account per IP" check trivially skippable.
  const ip = getClientIp(req)

  if (ip === 'unknown') {
    return NextResponse.json({ ip, blocked: false })
  }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('profiles')
    .select('username')
    .eq('ip_registro', ip)
    .maybeSingle()

  if (existing?.username) {
    return NextResponse.json({ blocked: true })
  }

  return NextResponse.json({ ip, blocked: false })
}

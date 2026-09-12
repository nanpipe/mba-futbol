import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { notifyAdmins } from '@/lib/notifyAdmins'
import { isRateLimited, getClientIp } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

// POST /api/notify/signup — called by registro page after successful auth signup
// No auth required: only enqueues a "new access request" digest item for admins.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false }, { status: 400 }) }

  const username = typeof body.username === 'string' ? body.username.slice(0, 64).trim().toLowerCase() : null
  if (!username) return NextResponse.json({ ok: false }, { status: 400 })

  // Unauthenticated by necessity (runs right after signup), so anyone could
  // replay it for a pending username and flood the admins with pushes.
  // One notification per username, a few per IP.
  const ip = getClientIp(req)
  if (isRateLimited(`notify-signup-ip:${ip}`, 5, 60 * 60 * 1000)) return NextResponse.json({ ok: true })
  if (isRateLimited(`notify-signup-user:${username}`, 1, 24 * 60 * 60 * 1000)) return NextResponse.json({ ok: true })

  const admin = createAdminClient()

  // Verify username actually exists and is pending approval — prevents spam from arbitrary callers
  const { data: profile } = await admin
    .from('profiles')
    .select('id, aprobado, club_id, created_at')
    .eq('username', username)
    .single()
  if (!profile) return NextResponse.json({ ok: true }) // silent — don't reveal existence
  if (profile.aprobado) return NextResponse.json({ ok: true }) // already approved
  if (!profile.club_id) return NextResponse.json({ ok: true })
  // Only a signup that just happened — the in-memory limit resets on cold start.
  const edadMs = Date.now() - new Date((profile as { created_at: string }).created_at).getTime()
  if (!(edadMs >= 0 && edadMs < 15 * 60 * 1000)) return NextResponse.json({ ok: true })

  // Immediate, channel-gated (push on by default, email off until admin enables).
  await notifyAdmins(admin, profile.club_id, 'signup', '🙋 Nueva solicitud de acceso', `@${username} solicitó acceso. Revísalo en el panel.`)

  await logActivity({ user_id: profile.id, username, accion: 'registro', detalles: { username } })

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { notifyAdmins } from '@/lib/notifyAdmins'

export const dynamic = 'force-dynamic'

// POST /api/notify/signup — called by registro page after successful auth signup
// No auth required: only enqueues a "new access request" digest item for admins.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false }, { status: 400 }) }

  const username = typeof body.username === 'string' ? body.username.slice(0, 64).trim() : null
  if (!username) return NextResponse.json({ ok: false }, { status: 400 })

  const admin = createAdminClient()

  // Verify username actually exists and is pending approval — prevents spam from arbitrary callers
  const { data: profile } = await admin
    .from('profiles')
    .select('id, aprobado, club_id')
    .eq('username', username)
    .single()
  if (!profile) return NextResponse.json({ ok: true }) // silent — don't reveal existence
  if (profile.aprobado) return NextResponse.json({ ok: true }) // already approved
  if (!profile.club_id) return NextResponse.json({ ok: true })

  // Immediate, channel-gated (push on by default, email off until admin enables).
  await notifyAdmins(admin, profile.club_id, 'signup', '🙋 Nueva solicitud de acceso', `@${username} solicitó acceso. Revísalo en el panel.`)

  await logActivity({ user_id: profile.id, username, accion: 'registro', detalles: { username } })

  return NextResponse.json({ ok: true })
}

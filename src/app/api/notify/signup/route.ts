import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush, isDeadPushError } from '@/lib/push'
import { sendAdminAlertEmail } from '@/lib/email'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

// POST /api/notify/signup — called by registro page after successful auth signup
// No auth required: only sends "new access request" notification to admins, no sensitive action taken
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
  if (profile.aprobado) return NextResponse.json({ ok: true }) // already approved, no notification needed

  // Notify admins + superadmins of the new user's club
  let adminQuery = admin.from('profiles').select('id, email').in('role', ['admin', 'superadmin'])
  if (profile.club_id) adminQuery = adminQuery.eq('club_id', profile.club_id)
  const { data: adminProfiles } = await adminQuery
  const adminIds = (adminProfiles ?? []).map((p: { id: string }) => p.id)
  if (!adminIds.length) return NextResponse.json({ ok: true, enviados: 0 })

  // Email admins too
  for (const a of (adminProfiles ?? []) as { email?: string }[]) {
    if (!a.email) continue
    try {
      await sendAdminAlertEmail({
        email: a.email,
        titulo: '🙋 Nueva solicitud de acceso',
        mensaje: `@${username} quiere unirse al equipo. Revísalo en el panel de admin.`,
      })
    } catch (err) { console.error('[notify/signup] email failed:', err) }
  }

  const { data: subs } = await admin
    .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', adminIds)

  let enviados = 0
  for (const sub of subs ?? []) {
    try {
      await sendPush(sub, {
        title: '🙋 Nueva solicitud de acceso',
        body: `@${username} quiere unirse al equipo. Revisa en el panel de admin.`,
        url: '/admin',
      })
      enviados++
    } catch (err) {
      if (isDeadPushError(err)) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      } else {
        console.error('[notify/signup] sendPush failed:', err)
      }
    }
  }

  await logActivity({
    user_id: profile.id,
    username,
    accion: 'registro',
    detalles: { username },
  })

  await logActivity({
    accion: 'notif_nueva_solicitud',
    detalles: { username, push_enviados: enviados, admins_notificados: adminIds.length },
  })

  return NextResponse.json({ ok: true, enviados })
}

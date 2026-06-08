import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'
import { logActivity } from '@/lib/activityLog'
import { sendAdminAlertEmail } from '@/lib/email'

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
    .select('id, aprobado')
    .eq('username', username)
    .single()
  if (!profile) return NextResponse.json({ ok: true }) // silent — don't reveal existence
  if (profile.aprobado) return NextResponse.json({ ok: true }) // already approved, no notification needed

  const { data: adminProfiles } = await admin.from('profiles').select('id').eq('role', 'admin')
  const adminIds = (adminProfiles ?? []).map((p: { id: string }) => p.id)
  if (!adminIds.length) return NextResponse.json({ ok: true, enviados: 0 })

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
      const code = (err as { statusCode?: number }).statusCode
      if (code === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      } else {
        console.error('[notify/signup] sendPush failed:', err)
      }
    }
  }

  // Also email each admin (best-effort)
  {
    const { data: adminEmailProfiles } = await admin
      .from('profiles')
      .select('email, username')
      .in('id', adminIds)
    // Get club name best-effort
    let clubNombre = 'MBA Fútbol Club'
    try {
      const { data: profileForClub } = await admin.from('profiles').select('club_id').eq('id', profile.id).single()
      if (profileForClub?.club_id) {
        const { data: clubSetting } = await admin
          .from('app_settings')
          .select('value')
          .eq('club_id', profileForClub.club_id)
          .eq('key', 'club_nombre')
          .maybeSingle()
        if (clubSetting?.value && typeof clubSetting.value === 'string') clubNombre = clubSetting.value
      }
    } catch { /* ignore */ }
    for (const ap of (adminEmailProfiles ?? []) as { email?: string; username?: string }[]) {
      if (ap.email) {
        sendAdminAlertEmail({
          email: ap.email,
          titulo: '🙋 Nueva solicitud de acceso',
          mensaje: `@${username} quiere unirse al equipo. Revísalo en el panel de admin.`,
          clubNombre,
        }).catch(e => console.error('[notify/signup] admin email failed:', e))
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

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'

export const dynamic = 'force-dynamic'

// POST /api/notify/signup — called by registro page after successful auth signup
// No auth required: only sends "new access request" notification to admins, no sensitive action taken
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false }, { status: 400 }) }

  const username = typeof body.username === 'string' ? body.username.slice(0, 64).trim() : null
  if (!username) return NextResponse.json({ ok: false }, { status: 400 })

  const admin = createAdminClient()

  const { data: adminProfiles } = await admin.from('profiles').select('id').eq('role', 'admin')
  const adminIds = (adminProfiles ?? []).map((p: { id: string }) => p.id)
  if (!adminIds.length) return NextResponse.json({ ok: true, enviados: 0 })

  const { data: subs } = await admin
    .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', adminIds)

  let enviados = 0
  for (const sub of subs ?? []) {
    await sendPush(sub, {
      title: '🙋 Nueva solicitud de acceso',
      body: `@${username} quiere unirse al equipo. Revisa en el panel de admin.`,
      url: '/admin',
    }).catch(err => {
      if ((err as { statusCode?: number }).statusCode === 410) {
        admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).then(() => {})
      }
    })
    enviados++
  }

  return NextResponse.json({ ok: true, enviados })
}

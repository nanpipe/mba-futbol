import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubId } from '@/lib/club'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const clubId = getClubId(req)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const sub = await req.json()
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 })
  }

  const { error } = await admin
    .from('push_subscriptions')
    .upsert(
      { club_id: clubId, player_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      { onConflict: 'player_id,endpoint' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let parsed: Record<string, unknown>
  try { parsed = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { endpoint } = parsed
  if (typeof endpoint !== 'string' || endpoint.length < 1 || endpoint.length > 2048) {
    return NextResponse.json({ error: 'endpoint inválido' }, { status: 400 })
  }

  await admin
    .from('push_subscriptions')
    .delete()
    .eq('player_id', user.id)
    .eq('endpoint', endpoint)

  return NextResponse.json({ ok: true })
}

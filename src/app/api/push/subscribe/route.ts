import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isRateLimited, getClientIp } from '@/lib/rateLimit'

// Hosts of the push services browsers actually hand out (Chrome/Android,
// Firefox, Safari/iOS, Edge/Windows). Anything else is refused.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
]

function esEndpointPushValido(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.port === '' && !u.username && !u.password && PUSH_HOSTS.some(r => r.test(u.hostname))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (isRateLimited(`push-subscribe:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 })
  }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await admin.from('profiles').select('club_id').eq('id', user.id).single()
  if (!profile?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = profile.club_id

  let sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  try { sub = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const { endpoint } = sub ?? {}
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth
  if (
    typeof endpoint !== 'string' || endpoint.length > 2048 ||
    typeof p256dh !== 'string' || p256dh.length > 256 ||
    typeof auth !== 'string' || auth.length > 256
  ) {
    return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 })
  }
  // The server later POSTs to this URL (web-push). Accepting any URL let a
  // logged-in user point our server at arbitrary hosts — internal ones included.
  if (!esEndpointPushValido(endpoint)) {
    return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 })
  }

  const { error } = await admin
    .from('push_subscriptions')
    .upsert(
      { club_id: clubId, player_id: user.id, endpoint, p256dh, auth },
      { onConflict: 'player_id,endpoint' }
    )

  if (error) {
    console.error('[push/subscribe] upsert failed:', error.message)
    return NextResponse.json({ error: 'No se pudo guardar la suscripción' }, { status: 500 })
  }
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

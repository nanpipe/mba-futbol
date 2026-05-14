import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

const IP_BLOCK_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('username, role')
    .eq('id', user.id)
    .single()

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null

  let body: { device_id?: string } = {}
  try { body = await req.json() } catch { /* no body */ }
  const deviceId = typeof body.device_id === 'string' && body.device_id.length > 0
    ? body.device_id.slice(0, 128)
    : null

  const role = (profile as { role?: string })?.role ?? 'player'
  const username = (profile as { username?: string })?.username ?? user.email ?? 'unknown'

  // ── Conflict check (skip for admins) ─────────────────────────────────────
  if (role !== 'admin') {
    const since = new Date(Date.now() - IP_BLOCK_WINDOW_MS).toISOString()

    // Build OR filter: block if same IP OR same device_id used by a different user
    type ConflictResult = { data: { user_id: string } | null }
    const checks: Promise<ConflictResult>[] = []

    if (ip) {
      checks.push(
        (admin.from('activity_log').select('user_id')
          .eq('accion', 'login').eq('ip', ip)
          .neq('user_id', user.id).gte('created_at', since)
          .not('detalles', 'cs', '{"role":"admin"}')  // admin logins don't block players
          .limit(1).maybeSingle()) as unknown as Promise<ConflictResult>
      )
    }

    if (deviceId) {
      checks.push(
        (admin.from('activity_log').select('user_id')
          .eq('accion', 'login')
          .not('detalles', 'cs', '{"role":"admin"}')  // admin logins don't block players
          .contains('detalles', { device_id: deviceId })
          .neq('user_id', user.id).gte('created_at', since)
          .limit(1).maybeSingle()) as unknown as Promise<ConflictResult>
      )
    }

    const results = await Promise.all(checks)
    const conflict = results.find(r => r.data !== null)

    if (conflict) {
      await supabase.auth.signOut()
      // Fetch conflicting username for display
      const { data: conflictProfile } = await admin
        .from('profiles').select('username').eq('id', conflict.data!.user_id).single()
      const conflictingUsername = (conflictProfile as { username?: string })?.username ?? null

      await logActivity({
        user_id: user.id,
        username,
        accion: 'login_bloqueado_ip',
        detalles: { ip, device_id: deviceId, conflicting_user_id: conflict.data!.user_id, conflicting_username: conflictingUsername },
        ip,
      })
      return NextResponse.json(
        { blocked: true, conflicting_username: conflictingUsername },
        { status: 429 }
      )
    }
  }

  await logActivity({
    user_id: user.id,
    username,
    accion: 'login',
    detalles: { role, device_id: deviceId },
    ip,
  })

  return NextResponse.json({ ok: true })
}

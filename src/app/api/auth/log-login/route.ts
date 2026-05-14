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

  // ── IP conflict check ─────────────────────────────────────────────────────
  // Block if a DIFFERENT user already logged in from this IP within the last hour.
  // Skip check for null IPs (dev/localhost) and admin users.
  const role = (profile as { role?: string })?.role ?? 'player'
  if (ip && role !== 'admin') {
    const since = new Date(Date.now() - IP_BLOCK_WINDOW_MS).toISOString()
    const { data: recentLogin } = await admin
      .from('activity_log')
      .select('user_id, username')
      .eq('accion', 'login')
      .eq('ip', ip)
      .neq('user_id', user.id)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle()

    if (recentLogin) {
      // Sign them out immediately — session was briefly valid
      await supabase.auth.signOut()

      await logActivity({
        user_id: user.id,
        username: (profile as { username?: string })?.username ?? 'unknown',
        accion: 'login_bloqueado_ip',
        detalles: { ip, conflicting_user_id: recentLogin.user_id },
        ip,
      })

      return NextResponse.json(
        { error: 'Ya hay una sesión activa desde esta red. Espera 1 hora o usa datos móviles.' },
        { status: 429 }
      )
    }
  }

  await logActivity({
    user_id: user.id,
    username: (profile as { username?: string })?.username ?? user.email ?? 'unknown',
    accion: 'login',
    detalles: { role },
    ip,
  })

  return NextResponse.json({ ok: true })
}

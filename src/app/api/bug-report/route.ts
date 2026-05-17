import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'

export const dynamic = 'force-dynamic'

// Supabase storage URL prefix — screenshots must come from our own bucket
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Verify user is registered + approved (not a random API call)
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('username, aprobado')
    .eq('id', user.id)
    .single()

  if (!profile?.aprobado) {
    return NextResponse.json({ error: 'Cuenta no aprobada' }, { status: 403 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : ''
  const screenshot_url = typeof body.screenshot_url === 'string' ? body.screenshot_url.trim() : null

  // ── Validate inputs ───────────────────────────────────────────────────────
  if (descripcion.length < 3 || descripcion.length > 500) {
    return NextResponse.json({ error: 'Descripción debe tener entre 3 y 500 caracteres.' }, { status: 400 })
  }

  if (screenshot_url !== null) {
    // Must be a URL from our own Supabase storage (bug-reports bucket)
    const validPrefix = `${SUPABASE_URL}/storage/v1/object`
    if (!screenshot_url.startsWith(validPrefix) || !screenshot_url.includes('/bug-reports/')) {
      return NextResponse.json({ error: 'URL de captura inválida.' }, { status: 400 })
    }
  }

  // ── Rate limit: max 3 reports per user per 24h ────────────────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('bug_reports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since)

  if ((count ?? 0) >= 3) {
    return NextResponse.json({ error: 'Límite de 3 reportes por día alcanzado. Intenta mañana.' }, { status: 429 })
  }

  // ── Insert report ─────────────────────────────────────────────────────────
  const { data: report, error: insertError } = await admin
    .from('bug_reports')
    .insert({
      user_id: user.id,
      username: profile.username,
      descripcion,
      screenshot_url,
    })
    .select('id')
    .single()

  if (insertError || !report) {
    console.error('[bug-report] insert error:', insertError)
    return NextResponse.json({ error: 'Error al guardar el reporte.' }, { status: 500 })
  }

  // ── Notify superadmins via push (fire-and-forget) ─────────────────────────
  ;(async () => {
    try {
      const { data: superadmins } = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'superadmin')

      if (!superadmins?.length) return

      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('player_id', superadmins.map((p: { id: string }) => p.id))

      if (!subs?.length) return

      const preview = descripcion.slice(0, 80) + (descripcion.length > 80 ? '…' : '')
      for (const sub of subs) {
        await sendPush(sub, {
          title: `🐛 Bug reportado por ${profile.username}`,
          body: preview,
          url: '/admin',
        }).catch(() => {})
      }
    } catch {
      // Non-critical — don't fail the request
    }
  })()

  return NextResponse.json({ ok: true })
}

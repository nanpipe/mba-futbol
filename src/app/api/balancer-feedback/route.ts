import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

async function getAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: p } = await supabase.from('profiles').select('role, username').eq('id', user.id).single()
  if (p?.role !== 'admin') return null
  return { ...user, username: (p as { username?: string })?.username ?? 'admin' }
}

// GET /api/balancer-feedback — fetch all feedback (admin only)
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await getAdminUser(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { data } = await admin
    .from('balancer_feedback')
    .select('id, feedback, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ ok: true, feedback: data ?? [] })
}

// POST /api/balancer-feedback — save new feedback (admin only)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await getAdminUser(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: { feedback: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  if (!body.feedback?.trim()) return NextResponse.json({ error: 'Feedback vacío' }, { status: 400 })
  if (body.feedback.trim().length > 1000) return NextResponse.json({ error: 'Feedback muy largo (máx 1000 chars)' }, { status: 400 })

  await admin.from('balancer_feedback').insert({
    feedback: body.feedback.trim(),
    admin_id: adminUser.id,
  })

  return NextResponse.json({ ok: true })
}

// DELETE /api/balancer-feedback — delete a single entry (admin only)
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await getAdminUser(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: { id: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  await admin.from('balancer_feedback').delete().eq('id', body.id)

  return NextResponse.json({ ok: true })
}

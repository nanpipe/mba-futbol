import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendUsernameEmail } from '@/lib/email'
import { isEmail } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'
import { getClubNombre } from '@/lib/club'
import { isRateLimited, getClientIp } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (isRateLimited(`recuperar-usuario:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const { email } = body
  if (!isEmail(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 400 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('username, aprobado')
    .eq('email', (email as string).trim().toLowerCase())
    .single()

  // Always return ok to avoid email enumeration
  if (!profile?.username) return NextResponse.json({ ok: true })

  await sendUsernameEmail({
    email: (email as string).trim().toLowerCase(),
    username: profile.username,
    clubNombre: getClubNombre(req),
  })

  await logActivity({ accion: 'recuperar_usuario', detalles: { email: (email as string).trim().toLowerCase() }, ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? undefined })

  return NextResponse.json({ ok: true })
}

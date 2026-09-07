import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isString } from '@/lib/validation'
import { isRateLimited, getClientIp } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

/**
 * Pre-authentication lookups against `profiles`, done server-side.
 *
 * The login, signup and password-recovery screens used to query `profiles`
 * straight from the browser, before any session exists — so those reads ran as
 * `anon` and only worked because a permissive policy exposed the whole table
 * (email, ip_registro, role and all) to anyone holding the public anon key.
 * Moving them here lets that policy be closed without breaking the flows.
 *
 * Returns the minimum each screen needs and nothing else.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (isRateLimited(`auth-resolver:${ip}`, 30, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 })
  }

  let body: { accion?: unknown; valor?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  if (!isString(body.valor, 1, 160)) {
    return NextResponse.json({ error: 'Valor inválido' }, { status: 400 })
  }
  const valor = (body.valor as string).trim().toLowerCase()
  const admin = createAdminClient()

  // ── Is this username taken? Signup only needs a yes/no. ──
  if (body.accion === 'username_disponible') {
    const { data } = await admin
      .from('profiles').select('id').eq('username', valor).maybeSingle()
    return NextResponse.json({ ok: true, disponible: !data })
  }

  // ── Resolve a username-or-email to the email Supabase auth expects. ──
  // Login and password recovery both need this. It reveals only whether an
  // account exists, which the login form already surfaces via its generic
  // error — no extra field is returned.
  if (body.accion === 'email_de') {
    const col = valor.includes('@') ? 'email' : 'username'
    const { data } = await admin
      .from('profiles').select('email, aprobado').eq(col, valor).maybeSingle()
    if (!data?.email) return NextResponse.json({ ok: true, email: null })
    return NextResponse.json({ ok: true, email: data.email, aprobado: data.aprobado })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

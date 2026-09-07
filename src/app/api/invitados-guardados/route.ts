import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID, isSingleLine, isEmail, safeError } from '@/lib/validation'

export const dynamic = 'force-dynamic'

const MAX_GUARDADOS = 30

/** Resolve the caller and their club, or null when unauthenticated. */
async function getCaller() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: prof } = await admin.from('profiles').select('club_id, aprobado').eq('id', user.id).single()
  if (!prof?.club_id || !prof.aprobado) return null
  return { admin, user, clubId: prof.club_id as string }
}

/** Shared name/email validation for create + update. */
function parseBody(body: { nombre?: unknown; email?: unknown }) {
  if (!isSingleLine(body.nombre, 2, 80)) return { error: 'Nombre inválido (2 a 80 caracteres, sin saltos de línea)' as const }
  const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (emailRaw && !isEmail(emailRaw)) return { error: 'Email inválido' as const }
  return { nombre: (body.nombre as string).trim(), email: emailRaw || null }
}

// GET /api/invitados-guardados — the caller's saved guests
export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data, error } = await caller.admin
    .from('invitados_guardados')
    .select('id, nombre, email')
    .eq('player_id', caller.user.id)
    .order('nombre', { ascending: true })

  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
  return NextResponse.json({ ok: true, invitados: data ?? [] })
}

// POST /api/invitados-guardados — save a new one
export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { nombre?: unknown; email?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const parsed = parseBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { count } = await caller.admin
    .from('invitados_guardados')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', caller.user.id)

  if ((count ?? 0) >= MAX_GUARDADOS) {
    return NextResponse.json({ error: `Máximo ${MAX_GUARDADOS} invitados guardados` }, { status: 400 })
  }

  const { data, error } = await caller.admin
    .from('invitados_guardados')
    .insert({
      club_id: caller.clubId,
      player_id: caller.user.id,
      nombre: parsed.nombre,
      email: parsed.email,
    })
    .select('id, nombre, email')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Ya tienes un invitado guardado con ese nombre' }, { status: 409 })
    }
    return NextResponse.json({ error: safeError(error) }, { status: 500 })
  }
  return NextResponse.json({ ok: true, invitado: data })
}

// PATCH /api/invitados-guardados — edit one of your own
export async function PATCH(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { id?: unknown; nombre?: unknown; email?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  if (!isUUID(body.id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  const parsed = parseBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // player_id in the filter is what stops one player editing another's list.
  const { data, error } = await caller.admin
    .from('invitados_guardados')
    .update({ nombre: parsed.nombre, email: parsed.email, updated_at: new Date().toISOString() })
    .eq('id', body.id as string)
    .eq('player_id', caller.user.id)
    .select('id, nombre, email')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Ya tienes un invitado guardado con ese nombre' }, { status: 409 })
    }
    return NextResponse.json({ error: safeError(error) }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Invitado no encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true, invitado: data })
}

// DELETE /api/invitados-guardados — remove one of your own
export async function DELETE(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }
  if (!isUUID(body.id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const { error } = await caller.admin
    .from('invitados_guardados')
    .delete()
    .eq('id', body.id as string)
    .eq('player_id', caller.user.id)

  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
  return NextResponse.json({ ok: true })
}

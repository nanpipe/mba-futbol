import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID, isString, safeError } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'
import { generarCodigo, validarCodigo, textoInvalida } from '@/lib/invitaciones'

export const dynamic = 'force-dynamic'

const MAX_VIGENTES = 50

async function getCaller() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: prof } = await admin
    .from('profiles').select('role, username, club_id').eq('id', user.id).single()
  const role = (prof as { role?: string })?.role
  if (role !== 'admin' && role !== 'superadmin') return null
  return {
    admin,
    user,
    role: role as 'admin' | 'superadmin',
    username: (prof as { username?: string })?.username ?? 'admin',
    clubId: (prof as { club_id?: string })?.club_id ?? null,
  }
}

// ── GET /api/invitaciones — list codes the caller is allowed to see ─────────
export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  // Superadmin sees club invites (which have no club yet) plus their own club's.
  // A club admin only ever sees their own club's player invites.
  let query = caller.admin
    .from('invitaciones')
    .select('id, codigo, tipo, club_id, club_nombre, usado_por, usado_at, expira_at, revocada, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  query = caller.role === 'superadmin'
    ? query.or(`tipo.eq.club,club_id.eq.${caller.clubId}`)
    : query.eq('tipo', 'jugador').eq('club_id', caller.clubId ?? '')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
  return NextResponse.json({ ok: true, invitaciones: data ?? [], role: caller.role })
}

// ── POST /api/invitaciones — mint a code ───────────────────────────────────
export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: { tipo?: unknown; club_nombre?: unknown; dias?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const tipo = body.tipo === 'club' ? 'club' : 'jugador'

  // Only a superadmin can create clubs. This is the whole point of the gate:
  // without it, anyone with a code could spin up clubs indefinitely.
  if (tipo === 'club' && caller.role !== 'superadmin') {
    return NextResponse.json({ error: 'Solo un superadmin puede invitar a crear un club.' }, { status: 403 })
  }
  if (tipo === 'jugador' && !caller.clubId) {
    return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  }

  const { count } = await caller.admin
    .from('invitaciones')
    .select('id', { count: 'exact', head: true })
    .is('usado_at', null)
    .eq('revocada', false)
  if ((count ?? 0) >= MAX_VIGENTES) {
    return NextResponse.json({ error: `Hay demasiados códigos sin usar (${MAX_VIGENTES}). Revoca alguno primero.` }, { status: 400 })
  }

  const dias = typeof body.dias === 'number' && body.dias > 0 && body.dias <= 365 ? body.dias : 30
  const expira = new Date(Date.now() + dias * 86400000).toISOString()

  const row = {
    codigo: generarCodigo(),
    tipo,
    club_id: tipo === 'jugador' ? caller.clubId : null,
    club_nombre: tipo === 'club' && isString(body.club_nombre, 2, 60) ? (body.club_nombre as string).trim() : null,
    creado_por: caller.user.id,
    expira_at: expira,
  }

  const { data, error } = await caller.admin.from('invitaciones').insert(row).select().single()
  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

  await logActivity({
    user_id: caller.user.id,
    username: caller.username,
    accion: 'crear_invitacion',
    detalles: { tipo, club_nombre: row.club_nombre, expira_at: expira },
  })

  return NextResponse.json({ ok: true, invitacion: data })
}

// ── DELETE /api/invitaciones — revoke ──────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: { id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }
  if (!isUUID(body.id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const { data: inv } = await caller.admin
    .from('invitaciones').select('id, tipo, club_id, usado_at').eq('id', body.id as string).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'Invitación no encontrada' }, { status: 404 })
  if ((inv as { usado_at?: string }).usado_at) {
    return NextResponse.json({ error: 'Esa invitación ya fue usada.' }, { status: 409 })
  }

  // A club admin may only revoke their own club's codes; club-type codes are
  // superadmin territory.
  const i = inv as { tipo: string; club_id: string | null }
  const puede = caller.role === 'superadmin'
    ? true
    : i.tipo === 'jugador' && i.club_id === caller.clubId
  if (!puede) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  await caller.admin.from('invitaciones').update({ revocada: true }).eq('id', body.id as string)
  await logActivity({ user_id: caller.user.id, username: caller.username, accion: 'revocar_invitacion', detalles: { id: body.id } })
  return NextResponse.json({ ok: true })
}

// ── PUT /api/invitaciones — public: check a code before showing the form ────
// Unauthenticated by design (the account doesn't exist yet). Returns only what
// the signup screen needs to render, never who created it or which club id.
export async function PUT(req: NextRequest) {
  const admin = createAdminClient()
  let body: { codigo?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const res = await validarCodigo(admin, body.codigo)
  if (!res.ok) return NextResponse.json({ ok: false, error: textoInvalida(res.motivo) }, { status: 404 })

  const { invitacion } = res
  let clubNombre = invitacion.club_nombre
  if (invitacion.tipo === 'jugador' && invitacion.club_id) {
    const { data: club } = await admin.from('clubs').select('nombre').eq('id', invitacion.club_id).single()
    clubNombre = (club as { nombre?: string } | null)?.nombre ?? null
  }

  return NextResponse.json({ ok: true, tipo: invitacion.tipo, club_nombre: clubNombre })
}

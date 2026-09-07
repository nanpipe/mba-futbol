import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVentanaPartido } from '@/lib/partidos'
import { isUUID, isSingleLine, isEmail, safeError } from '@/lib/validation'
import { sendPush, isDeadPushError } from '@/lib/push'
import { logActivity } from '@/lib/activityLog'
import { notificarInvitadoConfirmado } from '@/lib/invitados'
import { gameNumber } from '@/lib/gameConfig'

export const dynamic = 'force-dynamic'

// POST /api/invitados — agregar un invitado al partido
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: meProfile } = await admin.from('profiles').select('club_id').eq('id', user.id).single()
  if (!meProfile?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = meProfile.club_id

  // Club settings: invitados enabled? + per-player limit (superadmin-configurable)
  const { data: settingRows } = await admin
    .from('app_settings').select('key, value').eq('club_id', clubId).in('key', ['usar_invitados', 'max_invitados'])
  const settings: Record<string, unknown> = {}
  for (const r of (settingRows ?? []) as { key: string; value: unknown }[]) settings[r.key] = r.value
  if (settings['usar_invitados'] === false) {
    return NextResponse.json({ error: 'El sistema de invitados está desactivado.' }, { status: 403 })
  }
  const MAX_INVITADOS = gameNumber(settings, 'max_invitados')

  // Verify player is approved
  const { data: playerProfile } = await supabase.from('profiles').select('aprobado, username').eq('id', user.id).single()
  if (!playerProfile?.aprobado) return NextResponse.json({ error: 'Tu cuenta aún no ha sido aprobada.' }, { status: 403 })

  let body: { partido_id?: unknown; nombre?: unknown; email?: unknown; guardar?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { partido_id, nombre, email, guardar } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
  if (!isSingleLine(nombre, 2, 80)) return NextResponse.json({ error: 'Nombre inválido (2 a 80 caracteres, sin saltos de línea)' }, { status: 400 })
  // Email is optional — it exists so the guest can be told directly when they
  // get a spot. Reject a malformed one instead of silently dropping it.
  const emailRaw = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (emailRaw && !isEmail(emailRaw)) return NextResponse.json({ error: 'Email del invitado inválido' }, { status: 400 })
  const emailInvitado = emailRaw || null

  // Verify inscription window is open
  const { data: partido } = await admin
    .from('partidos')
    .select('id, fecha, hora, hora_apertura, dias_antes_apertura')
    .eq('club_id', clubId)
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  const { abierta } = calcularVentanaPartido(partido)
  if (!abierta) return NextResponse.json({ error: 'Las inscripciones están cerradas' }, { status: 400 })

  // Check max invitees per player per match
  const { count } = await admin
    .from('invitados')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)

  if ((count ?? 0) >= MAX_INVITADOS) {
    return NextResponse.json({ error: `Máximo ${MAX_INVITADOS} invitados por partido` }, { status: 400 })
  }

  // Assign espera position within invitados queue
  const { data: maxPos } = await admin
    .from('invitados')
    .select('posicion_espera')
    .eq('partido_id', partido_id)
    .order('posicion_espera', { ascending: false })
    .limit(1)
    .single()

  const posicion = ((maxPos as { posicion_espera: number } | null)?.posicion_espera ?? 0) + 1

  const { error } = await admin
    .from('invitados')
    .insert({
      club_id: clubId,
      partido_id,
      player_id: user.id,
      nombre: (nombre as string).trim(),
      email: emailInvitado,
      estado: 'espera',
      posicion_espera: posicion,
    })

  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

  // Optionally remember this guest for next time. Best-effort: the signup already
  // succeeded, so a failed bookmark must not surface as an error.
  if (guardar === true) {
    await admin.from('invitados_guardados').upsert({
      club_id: clubId,
      player_id: user.id,
      nombre: (nombre as string).trim(),
      email: emailInvitado,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'player_id,nombre' })
  }

  await logActivity({ user_id: user.id, username: (playerProfile as { username?: string })?.username ?? '', accion: 'alta_invitado', detalles: { partido_id, nombre: nombre as string, fecha: (partido as { fecha?: string })?.fecha } })
  return NextResponse.json({ ok: true, mensaje: `${nombre} agregado a lista de espera de invitados.` })
}

// DELETE /api/invitados — eliminar un invitado
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: meProfile } = await admin.from('profiles').select('club_id, role').eq('id', user.id).single()
  if (!meProfile?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = meProfile.club_id

  let body: { invitado_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { invitado_id } = body
  if (!isUUID(invitado_id)) return NextResponse.json({ error: 'invitado_id inválido' }, { status: 400 })

  // Only allow deleting own invitees (scoped to caller's club)
  const { data: inv } = await admin
    .from('invitados')
    .select('id, player_id')
    .eq('id', invitado_id)
    .eq('club_id', clubId)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitado no encontrado' }, { status: 404 })

  // Allow owner OR admin to delete
  const callerRole = (meProfile as { role?: string })?.role
  const isAdmin = callerRole === 'admin' || callerRole === 'superadmin'
  if (!isAdmin && inv.player_id !== user.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  await admin.from('invitados').delete().eq('id', invitado_id).eq('club_id', clubId)
  await logActivity({ user_id: user.id, accion: 'baja_invitado', detalles: { invitado_id } })
  return NextResponse.json({ ok: true })
}

// PATCH /api/invitados — admin confirms an invitado + notifies their invitador
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Admin only
  const { data: prof } = await admin.from('profiles').select('role, username, club_id').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin' && (prof as { role?: string })?.role !== 'superadmin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  if (!(prof as { club_id?: string })?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = (prof as { club_id: string }).club_id

  let body: { invitado_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { invitado_id } = body
  if (!isUUID(invitado_id)) return NextResponse.json({ error: 'invitado_id inválido' }, { status: 400 })

  // Fetch the invitado + invitador profile + partido info (scoped to admin's club)
  const { data: inv } = await admin
    .from('invitados')
    .select('id, nombre, estado, player_id, partido_id, profiles(username), partidos(fecha, dia_semana)')
    .eq('id', invitado_id as string)
    .eq('club_id', clubId)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitado no encontrado' }, { status: 404 })
  if (inv.estado === 'confirmado') return NextResponse.json({ error: 'Ya está confirmado' }, { status: 409 })

  // Check cupos: confirmed inscripciones + confirmed invitados must not exceed cupos_total
  const { data: partido } = await admin
    .from('partidos')
    .select('cupos_total')
    .eq('id', inv.partido_id)
    .single()

  const [{ count: confirmedIns }, { count: confirmedInv }] = await Promise.all([
    admin.from('inscripciones').select('id', { count: 'exact', head: true })
      .eq('partido_id', inv.partido_id).eq('estado', 'confirmado'),
    admin.from('invitados').select('id', { count: 'exact', head: true })
      .eq('partido_id', inv.partido_id).eq('estado', 'confirmado'),
  ])

  const totalConfirmados = (confirmedIns ?? 0) + (confirmedInv ?? 0)
  const cupos = (partido as { cupos_total: number } | null)?.cupos_total ?? 14

  if (totalConfirmados >= cupos) {
    return NextResponse.json(
      { error: `No hay cupos disponibles. Partido lleno (${totalConfirmados}/${cupos}).` },
      { status: 400 }
    )
  }

  // Confirm the invitado
  const { error } = await admin
    .from('invitados')
    .update({ estado: 'confirmado', posicion_espera: null })
    .eq('id', invitado_id as string)

  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

  // Notify: push + email to the inviting player, and the guest themselves if
  // they left an address. Shared with the cron promotion so both paths behave
  // identically and neither can double-send.
  try { await notificarInvitadoConfirmado(admin, invitado_id as string) }
  catch (notifErr) { console.error('[invitados] notificar failed:', notifErr) }

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'confirmar_invitado',
    detalles: { invitado_id, nombre: inv.nombre, invitador_id: inv.player_id },
  })

  return NextResponse.json({ ok: true, mensaje: `${inv.nombre} confirmado.` })
}

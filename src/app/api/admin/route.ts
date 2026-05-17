import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeError, isUUID, isString, isEmail, isDate, isIntInRange } from '@/lib/validation'
import { internalFetch } from '@/lib/internalFetch'
import { logActivity } from '@/lib/activityLog'
import { sendTestEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

async function verificarAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, username').eq('id', user.id).single()
  const role = (profile as { role?: string })?.role
  if (role !== 'admin' && role !== 'superadmin') return null
  return {
    ...user,
    username: (profile as { username?: string })?.username ?? 'admin',
    role: role as 'admin' | 'superadmin',
  }
}

const SUPERADMIN_ONLY = new Set(['eliminar_jugador', 'editar_jugador', 'cambiar_password'])
const PRIVILEGED_ROLES = new Set(['admin', 'superadmin'])
const isPrivileged = (role: string | undefined | null) => PRIVILEGED_ROLES.has(role ?? '')
const ERR_PRIVILEGED = NextResponse.json({ error: 'No se puede aplicar esta acción a un administrador o superadmin' }, { status: 403 })

function getIP(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}

// ── GET /api/admin?accion=logs|pendientes ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await verificarAdmin(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const accion = req.nextUrl.searchParams.get('accion')

  if (accion === 'logs') {
    const { data } = await admin
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    return NextResponse.json({ ok: true, logs: data ?? [] })
  }

  if (accion === 'pendientes') {
    const { data } = await admin
      .from('profiles')
      .select('id, username, email, created_at, ip_registro')
      .eq('aprobado', false)
      .neq('role', 'admin')
      .order('created_at', { ascending: false })
    return NextResponse.json({ ok: true, pendientes: data ?? [] })
  }

  if (accion === 'cartas') {
    const { data, error } = await admin
      .from('evaluaciones_carta')
      .select('*, profiles!evaluaciones_carta_player_id_fkey(username, avatar_url)')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message, detail: error.details, hint: error.hint }, { status: 500 })
    return NextResponse.json({ ok: true, cartas: data ?? [], count: data?.length ?? 0 })
  }

  if (accion === 'bugs') {
    const { data } = await admin
      .from('bug_reports')
      .select('id, username, descripcion, screenshot_url, estado, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    return NextResponse.json({ ok: true, bugs: data ?? [] })
  }

  if (accion === 'settings') {
    const { data } = await admin.from('app_settings').select('key, value, updated_at')
    const settings: Record<string, unknown> = {}
    for (const row of (data ?? [])) {
      settings[(row as { key: string; value: unknown }).key] = (row as { key: string; value: unknown }).value
    }
    return NextResponse.json({ ok: true, settings })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

// ── POST /api/admin — acciones de admin ───────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await verificarAdmin(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo de la solicitud inválido' }, { status: 400 })
  }
  const { accion } = body
  const ip = getIP(req)

  // Superadmin-only actions
  if (SUPERADMIN_ONLY.has(accion as string) && adminUser.role !== 'superadmin') {
    return NextResponse.json({ error: 'Acción reservada para superadmin' }, { status: 403 })
  }

  // ── Aprobar jugador pendiente ───────────────────────────────────────────────
  if (accion === 'aprobar_jugador') {
    const { player_id } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const { data: info } = await admin.from('profiles').select('username').eq('id', player_id as string).single()
    const { error } = await admin.from('profiles').update({ aprobado: true }).eq('id', player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'aprobar_jugador', detalles: { player_id, username: (info as { username?: string })?.username }, ip })
    return NextResponse.json({ ok: true, mensaje: `Jugador ${(info as { username?: string })?.username ?? ''} aprobado.` })
  }

  // ── Rechazar jugador pendiente (elimina la cuenta) ─────────────────────────
  if (accion === 'rechazar_jugador') {
    const { player_id } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const { data: info } = await admin.from('profiles').select('username, role').eq('id', player_id as string).single()
    if (isPrivileged((info as { role?: string })?.role)) return ERR_PRIVILEGED
    const { error } = await admin.auth.admin.deleteUser(player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'rechazar_jugador', detalles: { player_id, username: (info as { username?: string })?.username }, ip })
    return NextResponse.json({ ok: true, mensaje: `Solicitud de ${(info as { username?: string })?.username ?? ''} rechazada.` })
  }

  // ── Eliminar jugador permanentemente ──────────────────────────────────────
  if (accion === 'eliminar_jugador') {
    const { player_id } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const { data: info } = await admin.from('profiles').select('username, email, role').eq('id', player_id as string).single()
    const infoTyped = info as { username?: string; email?: string; role?: string } | null
    if (isPrivileged(infoTyped?.role)) return ERR_PRIVILEGED

    // Remove from future matches
    const hoy = new Date().toISOString().split('T')[0]
    const { data: ins } = await admin
      .from('inscripciones')
      .select('id, partido_id, estado, partidos(fecha)')
      .eq('player_id', player_id as string)

    for (const i of (ins ?? [])) {
      const fecha = (i as unknown as { partidos: { fecha: string } }).partidos?.fecha ?? ''
      if (fecha >= hoy) {
        await admin.from('inscripciones').delete().eq('id', i.id)
        if (i.estado === 'confirmado') {
          await admin.rpc('promover_espera', { p_partido_id: i.partido_id })
        }
      }
    }

    // Delete auth user — profile cascades via DB trigger / FK
    const { error } = await admin.auth.admin.deleteUser(player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'eliminar_jugador', detalles: { player_id, username: infoTyped?.username, email: infoTyped?.email }, ip })
    return NextResponse.json({ ok: true, mensaje: `Jugador ${infoTyped?.username ?? ''} eliminado permanentemente.` })
  }

  // ── Banear usuario ─────────────────────────────────────────────────────────
  if (accion === 'banear') {
    const { player_id, razon, fecha_liberacion } = body

    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })
    const razonSafe = isString(razon, 0, 300) ? (razon as string).trim() : 'Multa pendiente'
    const fechaSafe = isDate(fecha_liberacion) ? (fecha_liberacion as string) : null

    const { data: info } = await admin.from('profiles').select('username, role').eq('id', player_id as string).single()
    if (isPrivileged((info as { role?: string })?.role)) return ERR_PRIVILEGED
    const { error } = await admin
      .from('profiles')
      .update({
        baneado: true,
        fecha_ban: new Date().toISOString(),
        fecha_liberacion: fechaSafe,
        razon_ban: razonSafe,
      })
      .eq('id', player_id)

    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    const hoy = new Date().toISOString().split('T')[0]
    const { data: inscripciones } = await admin
      .from('inscripciones')
      .select('id, partido_id, estado, partidos(fecha)')
      .eq('player_id', player_id)

    for (const ins of (inscripciones ?? [])) {
      const fecha = (ins as unknown as { partidos: { fecha: string } }).partidos?.fecha ?? ''
      if (fecha >= hoy) {
        await admin.from('inscripciones').delete().eq('id', ins.id)
        if (ins.estado === 'confirmado') {
          await admin.rpc('promover_espera', { p_partido_id: ins.partido_id })
          await internalFetch('/api/notify', { method: 'POST' }).catch(() => {})
        }
      }
    }

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'banear', detalles: { player_id, username: (info as { username?: string })?.username, razon: razonSafe, fecha_liberacion: fechaSafe }, ip })
    return NextResponse.json({ ok: true, mensaje: 'Usuario suspendido y removido de partidos futuros.' })
  }

  // ── Liberar ban ────────────────────────────────────────────────────────────
  if (accion === 'liberar') {
    const { player_id } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const { data: info } = await admin.from('profiles').select('username').eq('id', player_id as string).single()
    const { error } = await admin
      .from('profiles')
      .update({ baneado: false, fecha_ban: null, fecha_liberacion: null, razon_ban: null })
      .eq('id', player_id)

    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'liberar_ban', detalles: { player_id, username: (info as { username?: string })?.username }, ip })
    return NextResponse.json({ ok: true })
  }

  // ── Remover de un partido ──────────────────────────────────────────────────
  if (accion === 'remover_partido') {
    const { player_id, partido_id } = body
    if (!isUUID(player_id) || !isUUID(partido_id)) {
      return NextResponse.json({ error: 'IDs inválidos' }, { status: 400 })
    }

    const { data: ins } = await admin
      .from('inscripciones')
      .select('id, estado, profiles!player_id(username), partidos(fecha)')
      .eq('player_id', player_id)
      .eq('partido_id', partido_id)
      .single()

    if (!ins) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    await admin.from('inscripciones').delete().eq('id', ins.id)

    if (ins.estado === 'confirmado') {
      await admin.rpc('promover_espera', { p_partido_id: partido_id })
      await internalFetch('/api/notify', { method: 'POST' })
    }

    const username = (ins as unknown as { profiles: { username: string } }).profiles?.username
    const fecha = (ins as unknown as { partidos: { fecha: string } }).partidos?.fecha
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'remover_partido', detalles: { player_id, partido_id, username, fecha }, ip })
    return NextResponse.json({ ok: true })
  }

  // ── Mover a espera ─────────────────────────────────────────────────────────
  if (accion === 'mover_espera') {
    const { player_id, partido_id } = body
    if (!isUUID(player_id) || !isUUID(partido_id)) {
      return NextResponse.json({ error: 'IDs inválidos' }, { status: 400 })
    }

    const { data: ins } = await admin
      .from('inscripciones')
      .select('id, estado, profiles!player_id(username)')
      .eq('player_id', player_id)
      .eq('partido_id', partido_id)
      .single()

    if (!ins) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    if (ins.estado !== 'confirmado') {
      return NextResponse.json({ error: 'Solo se pueden mover jugadores confirmados' }, { status: 400 })
    }

    // Get next espera position
    const { data: posicion } = await admin.rpc('siguiente_posicion_espera', { p_partido_id: partido_id })

    await admin.from('inscripciones')
      .update({ estado: 'espera', posicion_espera: posicion })
      .eq('id', ins.id)

    const username = (ins as unknown as { profiles: { username: string } }).profiles?.username
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'mover_espera', detalles: { player_id, partido_id, username }, ip })
    return NextResponse.json({ ok: true, mensaje: `${username} movido a lista de espera.` })
  }

  // ── Promover jugador específico de espera (con swap opcional) ───────────────
  if (accion === 'promover_espera_manual') {
    const { inscripcion_id, partido_id, swap_player_id } = body
    if (!isUUID(inscripcion_id) || !isUUID(partido_id)) {
      return NextResponse.json({ error: 'IDs inválidos' }, { status: 400 })
    }

    const { data: ins } = await admin
      .from('inscripciones')
      .select('id, estado, player_id, profiles!player_id(username)')
      .eq('id', inscripcion_id as string)
      .single()

    if (!ins) return NextResponse.json({ error: 'Inscripción no encontrada' }, { status: 404 })
    if ((ins as { estado: string }).estado !== 'espera') {
      return NextResponse.json({ error: 'El jugador no está en espera' }, { status: 400 })
    }

    const { count: confirmados } = await admin
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('partido_id', partido_id as string)
      .eq('estado', 'confirmado')

    const { data: partidoData } = await admin.from('partidos').select('cupos_total').eq('id', partido_id as string).single()
    const cupos = (partidoData as { cupos_total: number } | null)?.cupos_total ?? 14
    const lleno = (confirmados ?? 0) >= cupos

    if (lleno) {
      if (!isUUID(swap_player_id)) {
        return NextResponse.json({ error: 'Partido lleno. Debes elegir quién cede su cupo.' }, { status: 400 })
      }
      // Move swap player to end of espera queue
      const { data: swapIns } = await admin
        .from('inscripciones')
        .select('id, profiles!player_id(username)')
        .eq('partido_id', partido_id as string)
        .eq('player_id', swap_player_id as string)
        .eq('estado', 'confirmado')
        .single()

      if (!swapIns) return NextResponse.json({ error: 'Jugador a ceder no encontrado o no confirmado' }, { status: 404 })

      const { data: swapPos } = await admin.rpc('siguiente_posicion_espera', { p_partido_id: partido_id })
      await admin.from('inscripciones')
        .update({ estado: 'espera', posicion_espera: swapPos })
        .eq('id', swapIns.id)

      const swapUsername = ((swapIns as unknown as { profiles: { username: string } }).profiles)?.username
      await logActivity({
        user_id: adminUser.id,
        username: adminUser.username,
        accion: 'mover_espera',
        detalles: { player_id: swap_player_id, partido_id, username: swapUsername, forzado_por_promocion: true },
        ip,
      })
    }

    // Promote the espera player
    await admin.from('inscripciones')
      .update({ estado: 'confirmado', posicion_espera: null })
      .eq('id', inscripcion_id as string)

    // Queue promotion notification (email + push)
    const [{ data: promotedProfile }, { data: promotedPartido }] = await Promise.all([
      admin.from('profiles').select('email, username').eq('id', (ins as { player_id: string }).player_id).single(),
      admin.from('partidos').select('fecha').eq('id', partido_id as string).single(),
    ])
    if (promotedProfile && promotedPartido) {
      await admin.from('notificaciones_pendientes').insert({
        player_id: (ins as { player_id: string }).player_id,
        email: (promotedProfile as { email: string }).email,
        username: (promotedProfile as { username: string }).username,
        partido_id,
        fecha_partido: (promotedPartido as { fecha: string }).fecha,
        tipo: 'promovido',
      })
      await internalFetch('/api/notify', { method: 'POST' })
    }

    // Renumber remaining espera queue
    const { data: espera } = await admin
      .from('inscripciones')
      .select('id')
      .eq('partido_id', partido_id as string)
      .eq('estado', 'espera')
      .order('posicion_espera', { ascending: true, nullsFirst: false })
    for (let i = 0; i < (espera ?? []).length; i++) {
      await admin.from('inscripciones').update({ posicion_espera: i + 1 }).eq('id', espera![i].id)
    }

    const promoted = ((ins as unknown as { profiles: { username: string } }).profiles)?.username
    await logActivity({
      user_id: adminUser.id,
      username: adminUser.username,
      accion: 'promover_espera_manual',
      detalles: { inscripcion_id, partido_id, username: promoted, swap_player_id: swap_player_id ?? null },
      ip,
    })
    return NextResponse.json({ ok: true, mensaje: `${promoted} promovido a confirmado.` })
  }

  // ── Admin agrega jugador manualmente ────────────────────────────────────────
  if (accion === 'agregar_jugador_partido') {
    const { player_id, partido_id, estado: estadoRaw } = body
    if (!isUUID(player_id) || !isUUID(partido_id)) {
      return NextResponse.json({ error: 'IDs inválidos' }, { status: 400 })
    }
    const estado = estadoRaw === 'espera' ? 'espera' : 'confirmado'

    // Not already inscribed
    const { data: existing } = await admin.from('inscripciones').select('id')
      .eq('partido_id', partido_id as string).eq('player_id', player_id as string).maybeSingle()
    if (existing) return NextResponse.json({ error: 'El jugador ya está inscrito en este partido' }, { status: 409 })

    const { data: targetProfile } = await admin.from('profiles').select('username, aprobado').eq('id', player_id as string).single()
    if (!targetProfile?.aprobado) return NextResponse.json({ error: 'El jugador no está aprobado' }, { status: 400 })

    let posicion_espera: number | null = null
    if (estado === 'espera') {
      const { data: pos } = await admin.rpc('siguiente_posicion_espera', { p_partido_id: partido_id })
      posicion_espera = pos
    } else {
      // Check cupos if confirming
      const { count: confirmados } = await admin.from('inscripciones').select('id', { count: 'exact', head: true })
        .eq('partido_id', partido_id as string).eq('estado', 'confirmado')
      const { data: partidoData } = await admin.from('partidos').select('cupos_total').eq('id', partido_id as string).single()
      const cupos = (partidoData as { cupos_total: number } | null)?.cupos_total ?? 14
      if ((confirmados ?? 0) >= cupos) {
        return NextResponse.json({ error: 'No hay cupos disponibles. Agrégalo a espera o libera un cupo primero.' }, { status: 400 })
      }
    }

    const { error } = await admin.from('inscripciones').insert({
      partido_id,
      player_id,
      estado,
      posicion_espera,
      added_by: adminUser.id,
    })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    const targetUsername = (targetProfile as { username: string }).username
    await logActivity({
      user_id: adminUser.id,
      username: adminUser.username,
      accion: 'agregar_jugador_partido',
      detalles: { player_id, partido_id, username: targetUsername, estado },
      ip,
    })
    return NextResponse.json({ ok: true, mensaje: `${targetUsername} agregado como ${estado}.` })
  }

  // ── Crear partido ──────────────────────────────────────────────────────────
  if (accion === 'crear_partido') {
    const { fecha, hora, cupos_total, hora_apertura, dias_antes_apertura, tipo } = body

    if (!isDate(fecha)) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    if (!isIntInRange(cupos_total, 2, 30)) return NextResponse.json({ error: 'Cupos debe ser entre 2 y 30' }, { status: 400 })
    if (!isIntInRange(dias_antes_apertura, 0, 14)) return NextResponse.json({ error: 'Días antes debe ser entre 0 y 14' }, { status: 400 })

    const tipoPartido = tipo === 'minitorneo' ? 'minitorneo' : 'normal'
    const date = new Date((fecha as string) + 'T12:00:00')
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
    const dia_semana = dias[date.getDay()]

    const { error } = await admin
      .from('partidos')
      .insert({
        fecha: fecha as string,
        dia_semana,
        hora: isString(hora, 4, 8) ? (hora as string) : '19:00:00',
        cupos_total: parseInt(String(cupos_total), 10),
        hora_apertura: isString(hora_apertura, 4, 8) ? (hora_apertura as string) : '10:00:00',
        dias_antes_apertura: parseInt(String(dias_antes_apertura), 10),
        inscripcion_abierta: false,
        tipo: tipoPartido,
      })

    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'crear_partido', detalles: { fecha, dia_semana, hora, cupos_total, tipo: tipoPartido }, ip })
    return NextResponse.json({ ok: true, mensaje: `${tipoPartido === 'minitorneo' ? '🟣 Minitorneo' : 'Partido'} del ${dia_semana} ${fecha} creado.` })
  }

  // ── Editar partido ─────────────────────────────────────────────────────────
  if (accion === 'editar_partido') {
    const { partido_id, fecha, hora, cupos_total, hora_apertura, dias_antes_apertura } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
    if (!isDate(fecha)) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    if (!isIntInRange(cupos_total, 2, 30)) return NextResponse.json({ error: 'Cupos debe ser entre 2 y 30' }, { status: 400 })
    if (!isIntInRange(dias_antes_apertura, 0, 14)) return NextResponse.json({ error: 'Días antes debe ser entre 0 y 14' }, { status: 400 })

    const date = new Date((fecha as string) + 'T12:00:00')
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
    const dia_semana = dias[date.getDay()]

    const { error } = await admin.from('partidos').update({
      fecha: fecha as string,
      dia_semana,
      hora: isString(hora, 4, 8) ? (hora as string) : '19:00:00',
      cupos_total: parseInt(String(cupos_total), 10),
      hora_apertura: isString(hora_apertura, 4, 8) ? (hora_apertura as string) : '10:00:00',
      dias_antes_apertura: parseInt(String(dias_antes_apertura), 10),
    }).eq('id', partido_id as string)

    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'editar_partido', detalles: { partido_id, fecha, dia_semana, hora, cupos_total }, ip })
    return NextResponse.json({ ok: true, mensaje: `Partido del ${dia_semana} ${fecha} actualizado.` })
  }

  // ── Eliminar partido ───────────────────────────────────────────────────────
  if (accion === 'eliminar_partido') {
    const { partido_id } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

    const { data: p } = await admin.from('partidos').select('fecha, dia_semana').eq('id', partido_id as string).single()
    const { error } = await admin.from('partidos').delete().eq('id', partido_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'eliminar_partido', detalles: { partido_id, fecha: (p as { fecha?: string })?.fecha, dia_semana: (p as { dia_semana?: string })?.dia_semana }, ip })
    return NextResponse.json({ ok: true, mensaje: 'Partido eliminado.' })
  }

  // ── Editar jugador ─────────────────────────────────────────────────────────
  if (accion === 'editar_jugador') {
    const { player_id, email } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const updates: Record<string, string> = {}
    // username is immutable — not accepted here
    if (isEmail(email)) updates.email = (email as string).trim().toLowerCase()

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const { data: targetProf } = await admin.from('profiles').select('role').eq('id', player_id as string).single()
    if (isPrivileged((targetProf as { role?: string })?.role)) return ERR_PRIVILEGED

    const { error } = await admin.from('profiles').update(updates).eq('id', player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'editar_jugador', detalles: { player_id, ...updates }, ip })
    return NextResponse.json({ ok: true, mensaje: 'Jugador actualizado.' })
  }

  // ── Cambiar contraseña ─────────────────────────────────────────────────────
  if (accion === 'cambiar_password') {
    const { player_id, password } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })
    if (!isString(password, 6, 128)) {
      return NextResponse.json({ error: 'Contraseña debe tener entre 6 y 128 caracteres' }, { status: 400 })
    }

    const { data: targetProf } = await admin.from('profiles').select('role').eq('id', player_id as string).single()
    if (isPrivileged((targetProf as { role?: string })?.role)) return ERR_PRIVILEGED

    const { error } = await admin.auth.admin.updateUserById(player_id as string, { password: (password as string) })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'cambiar_password', detalles: { player_id }, ip })
    return NextResponse.json({ ok: true, mensaje: 'Contraseña actualizada.' })
  }

  // ── Toggle uniforme ────────────────────────────────────────────────────────
  if (accion === 'toggle_uniform') {
    const { player_id } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const { data: current } = await admin.from('profiles').select('uniform, username, role').eq('id', player_id as string).single()
    if (isPrivileged((current as { role?: string })?.role)) return ERR_PRIVILEGED
    const nuevoValor = !((current as { uniform?: boolean })?.uniform ?? false)

    const { error } = await admin.from('profiles').update({ uniform: nuevoValor }).eq('id', player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'toggle_uniform', detalles: { player_id, username: (current as { username?: string })?.username, uniform: nuevoValor }, ip })
    return NextResponse.json({ ok: true, uniform: nuevoValor, mensaje: nuevoValor ? 'Uniforme activado.' : 'Uniforme desactivado.' })
  }

  // ── Actualizar posición del jugador (admin) ────────────────────────────────
  if (accion === 'actualizar_posicion') {
    const { player_id, posicion } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })
    const POSICIONES = ['portero', 'defensa', 'medio', 'delantero', 'cualquiera']
    if (typeof posicion !== 'string' || !POSICIONES.includes(posicion)) {
      return NextResponse.json({ error: 'Posición inválida' }, { status: 400 })
    }
    const { error } = await admin.from('profiles').update({ posicion }).eq('id', player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'actualizar_posicion', detalles: { player_id, posicion }, ip })
    return NextResponse.json({ ok: true, mensaje: `Posición actualizada a ${posicion}.` })
  }

  // ── Confirmar que el partido se jugó ─────────────────────────────────────
  if (accion === 'confirmar_partido') {
    const { partido_id } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
    const { error } = await admin.from('partidos').update({ equipos_confirmados: true }).eq('id', partido_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'confirmar_partido', detalles: { partido_id }, ip })
    return NextResponse.json({ ok: true, mensaje: 'Partido confirmado.' })
  }

  // ── Registrar resultado del partido ───────────────────────────────────────
  if (accion === 'registrar_resultado') {
    const { partido_id, goles_a, goles_b, puntos_blanco, puntos_negro, puntos_morado } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

    // Fetch partido type to know which result format to apply
    const { data: pInfo } = await admin.from('partidos').select('tipo').eq('id', partido_id as string).single()
    const esMinitorneo = (pInfo as { tipo?: string })?.tipo === 'minitorneo'

    if (esMinitorneo) {
      const pB = typeof puntos_blanco === 'number' ? puntos_blanco : parseInt(String(puntos_blanco))
      const pN = typeof puntos_negro  === 'number' ? puntos_negro  : parseInt(String(puntos_negro))
      const pM = typeof puntos_morado === 'number' ? puntos_morado : parseInt(String(puntos_morado))
      if ([pB, pN, pM].some(p => isNaN(p) || p < 0)) return NextResponse.json({ error: 'Puntos inválidos' }, { status: 400 })

      const maxPts = Math.max(pB, pN, pM)
      const ganador = pB === maxPts && pN === maxPts && pM === maxPts ? 'empate'
        : pB === maxPts && pB > pN && pB > pM ? 'blanco'
        : pN === maxPts && pN > pB && pN > pM ? 'negro'
        : pM === maxPts && pM > pB && pM > pN ? 'morado'
        : 'empate'

      const resultado = `B${pB}-N${pN}-M${pM}`
      const { error } = await admin.from('partidos').update({
        resultado, puntos_blanco: pB, puntos_negro: pN, puntos_morado: pM,
      }).eq('id', partido_id as string)
      if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
      await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'registrar_resultado', detalles: { partido_id, resultado, ganador, tipo: 'minitorneo' }, ip })
      return NextResponse.json({ ok: true, mensaje: `Resultado minitorneo: ${resultado} — Ganó ${ganador}` })
    }

    // Normal partido: goles
    const gA = typeof goles_a === 'number' ? goles_a : parseInt(String(goles_a))
    const gB = typeof goles_b === 'number' ? goles_b : parseInt(String(goles_b))
    if (isNaN(gA) || isNaN(gB) || gA < 0 || gB < 0) return NextResponse.json({ error: 'Goles inválidos' }, { status: 400 })
    const resultado = `${gA}-${gB}`
    const { error } = await admin.from('partidos').update({ resultado, goles_a: gA, goles_b: gB }).eq('id', partido_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'registrar_resultado', detalles: { partido_id, resultado, goles_a: gA, goles_b: gB }, ip })
    return NextResponse.json({ ok: true, mensaje: `Resultado registrado: ${resultado}` })
  }

  // ── Forzar notif apertura (debug) ────────────────────────────────────────
  if (accion === 'forzar_notif_apertura') {
    const { partido_id } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
    const { data: partido } = await admin.from('partidos').select('dia_semana').eq('id', partido_id as string).single()
    const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth')
    const { sendPush } = await import('@/lib/push')
    let enviados = 0
    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, {
          title: '⚽ ¡Inscripciones abiertas!',
          body: `Ya puedes anotarte para el partido del ${(partido as { dia_semana?: string })?.dia_semana ?? ''}. ¡Entra ahora!`,
          url: '/',
        })
        enviados++
      } catch { /* ignore dead subs */ }
    }
    await admin.from('partidos').update({ notif_apertura_sent: true }).eq('id', partido_id as string)
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'forzar_notif_apertura', detalles: { partido_id, enviados }, ip })
    return NextResponse.json({ ok: true, mensaje: `Notificación apertura enviada a ${enviados} dispositivos.` })
  }

  // ── Abrir evaluaciones (+ push a jugadores confirmados) ───────────────────
  if (accion === 'abrir_evaluaciones') {
    const { partido_id } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
    const { error } = await admin.from('partidos').update({ evaluaciones_abiertas: true }).eq('id', partido_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    const { data: ins } = await admin
      .from('inscripciones').select('player_id')
      .eq('partido_id', partido_id as string).eq('estado', 'confirmado')

    const playerIds = (ins ?? []).map(i => i.player_id)
    let pushEnviados = 0
    if (playerIds.length > 0) {
      const { data: subs } = await admin
        .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', playerIds)
      const { sendPush } = await import('@/lib/push')
      for (const sub of (subs ?? [])) {
        await sendPush(sub, {
          title: '📊 ¿Cómo jugaron?',
          body: 'Las evaluaciones del partido están abiertas. Evalúa a tus compañeros.',
          url: `/evaluar/${partido_id}`,
        }).then(() => { pushEnviados++ }).catch(() => {})
      }
    }

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'abrir_evaluaciones', detalles: { partido_id, push_enviados: pushEnviados, jugadores_confirmados: playerIds.length }, ip })
    return NextResponse.json({ ok: true, mensaje: 'Evaluaciones abiertas y jugadores notificados.' })
  }

  // ── Guardar foto del partido ───────────────────────────────────────────────
  if (accion === 'guardar_foto_partido') {
    const { partido_id, foto_url } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
    if (!isString(foto_url, 1, 2048)) return NextResponse.json({ error: 'URL inválida' }, { status: 400 })
    try { new URL(foto_url as string) } catch { return NextResponse.json({ error: 'URL inválida' }, { status: 400 }) }

    const { error } = await admin.from('partidos').update({ foto_url }).eq('id', partido_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'guardar_foto_partido', detalles: { partido_id }, ip })
    return NextResponse.json({ ok: true, mensaje: 'Foto guardada.' })
  }

  // ── Guardar setting ────────────────────────────────────────────────────────
  if (accion === 'guardar_setting') {
    const { key, value } = body
    const ALLOWED_KEYS = [
      'notif_apertura', 'notif_recordatorio', 'notif_cupos', 'notif_invitados',
      'email_apertura', 'email_recordatorio',
      'usar_uniforme', 'usar_invitados', 'usuarios_pueden_cambiar_username',
      'club_nombre', 'club_ciudad', 'club_dias_juego',
    ]
    if (typeof key !== 'string' || !ALLOWED_KEYS.includes(key)) {
      return NextResponse.json({ error: 'Clave inválida' }, { status: 400 })
    }
    // Booleans stored as bool, strings stored as string
    const storedValue = typeof value === 'string' && value !== 'true' && value !== 'false'
      ? value
      : value === true || value === 'true'
    const { error } = await admin.from('app_settings').upsert({
      key,
      value: storedValue,
      updated_at: new Date().toISOString(),
      updated_by: adminUser.id,
    }, { onConflict: 'key' })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'guardar_setting', detalles: { key, value }, ip })
    return NextResponse.json({ ok: true, mensaje: `${key} → ${value}` })
  }

  // ── Enviar email de prueba ─────────────────────────────────────────────────
  if (accion === 'enviar_email_prueba') {
    const { email } = body
    if (!isEmail(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
    const result = await sendTestEmail({ email: (email as string).trim().toLowerCase() })
    if (!result.ok) return NextResponse.json({ error: result.error ?? 'Error enviando email' }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'enviar_email_prueba', detalles: { email }, ip })
    return NextResponse.json({ ok: true, mensaje: `Email de prueba enviado a ${email}`, id: result.id })
  }

  // ── Actualizar estado de bug report ───────────────────────────────────────
  if (accion === 'actualizar_bug_report') {
    const { bug_id, estado } = body
    if (!isUUID(bug_id)) return NextResponse.json({ error: 'bug_id inválido' }, { status: 400 })
    const ESTADOS_VALIDOS = ['nuevo', 'revisado', 'cerrado']
    if (typeof estado !== 'string' || !ESTADOS_VALIDOS.includes(estado)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    }
    const { error } = await admin.from('bug_reports').update({ estado }).eq('id', bug_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'actualizar_bug_report', detalles: { bug_id, estado }, ip })
    return NextResponse.json({ ok: true, mensaje: `Bug marcado como ${estado}.` })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

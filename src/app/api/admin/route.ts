import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeError, isUUID, isString, isEmail, isDate, isIntInRange } from '@/lib/validation'
import { internalFetch } from '@/lib/internalFetch'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

async function verificarAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, username').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return { ...user, username: (profile as { username?: string })?.username ?? 'admin' }
}

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
    if ((info as { role?: string })?.role === 'admin') return NextResponse.json({ error: 'No se puede aplicar esta acción a un administrador' }, { status: 403 })
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
    if (infoTyped?.role === 'admin') return NextResponse.json({ error: 'No se puede aplicar esta acción a un administrador' }, { status: 403 })

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
    if ((info as { role?: string })?.role === 'admin') return NextResponse.json({ error: 'No se puede aplicar esta acción a un administrador' }, { status: 403 })
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
          internalFetch('/api/notify', { method: 'POST' }).catch(() => {})
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
      .select('id, estado, profiles(username), partidos(fecha)')
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
      .select('id, estado, profiles(username)')
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

  // ── Crear partido ──────────────────────────────────────────────────────────
  if (accion === 'crear_partido') {
    const { fecha, hora, cupos_total, hora_apertura, dias_antes_apertura } = body

    if (!isDate(fecha)) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    if (!isIntInRange(cupos_total, 2, 30)) return NextResponse.json({ error: 'Cupos debe ser entre 2 y 30' }, { status: 400 })
    if (!isIntInRange(dias_antes_apertura, 0, 14)) return NextResponse.json({ error: 'Días antes debe ser entre 0 y 14' }, { status: 400 })

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
      })

    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'crear_partido', detalles: { fecha, dia_semana, hora, cupos_total }, ip })
    return NextResponse.json({ ok: true, mensaje: `Partido del ${dia_semana} ${fecha} creado.` })
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
    if ((targetProf as { role?: string })?.role === 'admin') return NextResponse.json({ error: 'No se puede aplicar esta acción a un administrador' }, { status: 403 })

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
    if ((targetProf as { role?: string })?.role === 'admin') return NextResponse.json({ error: 'No se puede aplicar esta acción a un administrador' }, { status: 403 })

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
    if ((current as { role?: string })?.role === 'admin') return NextResponse.json({ error: 'No se puede aplicar esta acción a un administrador' }, { status: 403 })
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

  // ── Registrar resultado del partido ───────────────────────────────────────
  if (accion === 'registrar_resultado') {
    const { partido_id, goles_a, goles_b } = body
    if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
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

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

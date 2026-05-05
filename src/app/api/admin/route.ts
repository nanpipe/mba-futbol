import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeError, isUUID, isString, isEmail, isDate, isIntInRange } from '@/lib/validation'
import { internalFetch } from '@/lib/internalFetch'

async function verificarAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return user
}

// POST /api/admin — acciones de admin
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

  // ── Banear usuario ─────────────────────────────────────────────────────────
  if (accion === 'banear') {
    const { player_id, razon, fecha_liberacion } = body

    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })
    const razonSafe = isString(razon, 0, 300) ? (razon as string).trim() : 'Multa pendiente'
    const fechaSafe = isDate(fecha_liberacion) ? (fecha_liberacion as string) : null

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

    return NextResponse.json({ ok: true, mensaje: 'Usuario suspendido y removido de partidos futuros.' })
  }

  // ── Liberar ban ────────────────────────────────────────────────────────────
  if (accion === 'liberar') {
    const { player_id } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const { error } = await admin
      .from('profiles')
      .update({ baneado: false, fecha_ban: null, fecha_liberacion: null, razon_ban: null })
      .eq('id', player_id)

    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
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
      .select('id, estado')
      .eq('player_id', player_id)
      .eq('partido_id', partido_id)
      .single()

    if (!ins) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    await admin.from('inscripciones').delete().eq('id', ins.id)

    if (ins.estado === 'confirmado') {
      await admin.rpc('promover_espera', { p_partido_id: partido_id })
      await internalFetch('/api/notify', { method: 'POST' })
    }

    return NextResponse.json({ ok: true })
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
    return NextResponse.json({ ok: true, mensaje: `Partido del ${dia_semana} ${fecha} creado.` })
  }

  // ── Editar jugador ─────────────────────────────────────────────────────────
  if (accion === 'editar_jugador') {
    const { player_id, username, email } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const updates: Record<string, string> = {}
    if (isString(username, 2, 50)) updates.username = (username as string).trim().toLowerCase()
    if (isEmail(email)) updates.email = (email as string).trim().toLowerCase()

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const { error } = await admin.from('profiles').update(updates).eq('id', player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    return NextResponse.json({ ok: true, mensaje: 'Jugador actualizado.' })
  }

  // ── Cambiar contraseña ─────────────────────────────────────────────────────
  if (accion === 'cambiar_password') {
    const { player_id, password } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })
    if (!isString(password, 6, 128)) {
      return NextResponse.json({ error: 'Contraseña debe tener entre 6 y 128 caracteres' }, { status: 400 })
    }

    const { error } = await admin.auth.admin.updateUserById(player_id as string, { password: (password as string) })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    return NextResponse.json({ ok: true, mensaje: 'Contraseña actualizada.' })
  }

  // ── Toggle uniforme ────────────────────────────────────────────────────────
  if (accion === 'toggle_uniform') {
    const { player_id } = body
    if (!isUUID(player_id)) return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })

    const { data: current } = await admin.from('profiles').select('uniform').eq('id', player_id as string).single()
    const nuevoValor = !(current?.uniform ?? false)

    const { error } = await admin.from('profiles').update({ uniform: nuevoValor }).eq('id', player_id as string)
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    return NextResponse.json({ ok: true, uniform: nuevoValor, mensaje: nuevoValor ? 'Uniforme activado.' : 'Uniforme desactivado.' })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

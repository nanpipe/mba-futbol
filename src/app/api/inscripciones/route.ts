import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVentanaPartido } from '@/lib/partidos'
import { safeError, isUUID } from '@/lib/validation'
import { internalFetch } from '@/lib/internalFetch'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

type InscripcionConUniform = { id: string; player_id: string; profiles: { uniform: boolean } }

// POST /api/inscripciones — inscribirse a un partido
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('baneado, fecha_liberacion, username, uniform, aprobado')
    .eq('id', user.id)
    .single()

  if (!profile?.aprobado) {
    return NextResponse.json({ error: 'Tu cuenta aún no ha sido aprobada por el administrador.' }, { status: 403 })
  }

  if (profile?.baneado) {
    const liberacion = profile.fecha_liberacion
      ? new Date(profile.fecha_liberacion).toLocaleDateString('es-CO')
      : 'indefinido'
    return NextResponse.json(
      { error: `Estás suspendido hasta el ${liberacion}. Contacta al admin para más info.` },
      { status: 403 }
    )
  }

  let body: { partido_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await admin
    .from('partidos')
    .select('id, cupos_total, fecha, hora, hora_apertura, dias_antes_apertura')
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  const ventana = calcularVentanaPartido(partido)
  if (!ventana.abierta) {
    return NextResponse.json({ error: 'Las inscripciones no están abiertas para este partido.' }, { status: 400 })
  }

  // Check not already inscribed
  const { data: yaInscrito } = await admin
    .from('inscripciones')
    .select('id, estado')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .single()

  if (yaInscrito) {
    return NextResponse.json(
      { error: `Ya estás inscrito en este partido (${yaInscrito.estado})` },
      { status: 409 }
    )
  }

  const { count: totalConfirmados } = await admin
    .from('inscripciones')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('estado', 'confirmado')

  // Check club setting: uniform priority enabled?
  const { data: uniformSetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'usar_uniforme')
    .maybeSingle()
  const usarUniforme = uniformSetting === null || (uniformSetting as { value: unknown })?.value !== false

  const tieneUniforme = usarUniforme ? ((profile as { uniform?: boolean })?.uniform ?? false) : true
  const spotsLibres = (totalConfirmados ?? 0) < partido.cupos_total

  // Helper: push all admins+superadmin (fire-and-forget)
  const pushAdmins = (titulo: string, cuerpo: string) => {
    ;(async () => {
      const { data: adminProfiles } = await admin
        .from('profiles').select('id').in('role', ['admin', 'superadmin'])
      const adminIds = (adminProfiles ?? []).map((a: { id: string }) => a.id)
      if (!adminIds.length) return
      const { data: subs } = await admin
        .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', adminIds)
      if (!subs?.length) return
      const { sendPush } = await import('@/lib/push')
      for (const sub of subs) {
        sendPush(sub, { title: titulo, body: cuerpo, url: '/admin' }).catch(() => {})
      }
    })().catch(() => {})
  }

  const dia = partido.fecha
    ? new Date(partido.fecha + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' })
    : ''

  // ── Uniform priority logic ─────────────────────────────────────────────────
  // Rule: players WITHOUT uniform always go to espera, no exceptions.
  // Uniformed players: confirmed if spots available, can bump non-uniform if full.

  if (!tieneUniforme) {
    // No uniform → always espera
  } else if (tieneUniforme && spotsLibres) {
    // Uniform + spots free → confirmed
    const { error } = await admin.from('inscripciones').insert({ partido_id, player_id: user.id, estado: 'confirmado' })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
    await logActivity({ user_id: user.id, username: profile.username, accion: 'inscripcion', detalles: { partido_id, fecha: partido.fecha, estado: 'confirmado' } })
    pushAdmins('✅ Nueva inscripción', `${profile.username} se inscribió (confirmado) — ${dia}`)
    return NextResponse.json({ estado: 'confirmado' })
  } else if (tieneUniforme && !spotsLibres) {
    // Uniform + full → try to bump the most-recent non-uniform confirmed player
    const { data: confirmed } = await admin
      .from('inscripciones')
      .select('id, player_id, profiles!player_id(uniform)')
      .eq('partido_id', partido_id)
      .eq('estado', 'confirmado')
      .order('created_at', { ascending: false })

    const toBump = (confirmed as unknown as InscripcionConUniform[])?.find(i => !i.profiles?.uniform)

    if (toBump) {
      await admin.rpc('incrementar_posiciones_espera', { p_partido_id: partido_id })
      await admin.from('inscripciones').update({ estado: 'espera', posicion_espera: 1 }).eq('id', toBump.id)
      const { error } = await admin.from('inscripciones').insert({ partido_id, player_id: user.id, estado: 'confirmado' })
      if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
      await logActivity({ user_id: user.id, username: profile.username, accion: 'inscripcion', detalles: { partido_id, fecha: partido.fecha, estado: 'confirmado_prioridad' } })
      await logActivity({ user_id: toBump.player_id, accion: 'bumped_espera', detalles: { partido_id, fecha: partido.fecha, bumped_by: profile.username } })
      pushAdmins('✅ Nueva inscripción (uniforme)', `${profile.username} entró confirmado — ${dia}`)
      return NextResponse.json({ estado: 'confirmado', prioridad: true })
    }
    // All confirmed slots taken by uniformed players → fall through to espera
  }

  // Fall-through: go to waiting list
  const { data: posicion } = await admin.rpc('siguiente_posicion_espera', { p_partido_id: partido_id })
  const { error } = await admin.from('inscripciones').insert({
    partido_id, player_id: user.id, estado: 'espera', posicion_espera: posicion
  })
  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
  await logActivity({ user_id: user.id, username: profile.username, accion: 'inscripcion', detalles: { partido_id, fecha: partido.fecha, estado: 'espera', posicion_espera: posicion } })
  pushAdmins('⏳ Nueva inscripción (espera)', `${profile.username} en lista de espera #${posicion} — ${dia}`)
  return NextResponse.json({ estado: 'espera', posicion_espera: posicion })
}

// DELETE /api/inscripciones — cancelar inscripción
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { partido_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id, estado')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .single()

  if (!inscripcion) return NextResponse.json({ error: 'No estás inscrito en este partido' }, { status: 404 })

  // Fetch info needed for admin notification before deletion
  const [{ data: playerProfile }, { data: partidoInfo }] = await Promise.all([
    admin.from('profiles').select('username').eq('id', user.id).single(),
    admin.from('partidos').select('fecha, dia_semana').eq('id', partido_id as string).single(),
  ])

  await admin.from('inscripciones').delete().eq('id', inscripcion.id)

  const username = (playerProfile as { username?: string } | null)?.username ?? 'Un jugador'
  const dia = (partidoInfo as { dia_semana?: string } | null)?.dia_semana ?? ''
  const estado = inscripcion.estado === 'confirmado' ? 'confirmado' : 'lista de espera'

  if (inscripcion.estado === 'confirmado') {
    await admin.rpc('promover_espera', { p_partido_id: partido_id })
    await internalFetch('/api/notify', { method: 'POST' }).catch(() => {})
  }

  // Log synchronously — before return so Vercel doesn't kill it
  const { logActivity } = await import('@/lib/activityLog')
  await logActivity({
    user_id: user.id,
    username,
    accion: 'baja_partido',
    detalles: { partido_id, estado_previo: inscripcion.estado, dia },
  })

  // Admin push — fire-and-forget (best-effort, not critical)
  ;(async () => {
    const { data: adminProfiles } = await admin
      .from('profiles').select('id').in('role', ['admin', 'superadmin'])
    const adminIds = (adminProfiles ?? []).map((a: { id: string }) => a.id)
    if (!adminIds.length) return
    const { data: subs } = await admin
      .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', adminIds)
    if (!subs?.length) return
    const { sendPush } = await import('@/lib/push')
    for (const sub of subs) {
      await sendPush(sub, {
        title: '⚠️ Baja en el partido',
        body: `${username} se retiró (${estado})${dia ? ` — ${dia}` : ''}`,
        url: '/admin',
      }).catch(() => {})
    }
  })().catch(() => {})

  return NextResponse.json({ ok: true })
}

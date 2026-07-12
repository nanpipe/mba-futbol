import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVentanaPartido } from '@/lib/partidos'
import { safeError, isUUID } from '@/lib/validation'
import { internalFetch } from '@/lib/internalFetch'
import { logActivity } from '@/lib/activityLog'
import { isRateLimited, getClientIp } from '@/lib/rateLimit'
import { notifyAdmins } from '@/lib/notifyAdmins'

export const dynamic = 'force-dynamic'

type InscripcionConUniform = { id: string; player_id: string; profiles: { uniform: boolean } }

// POST /api/inscripciones — inscribirse a un partido
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (isRateLimited(`inscripciones-post:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 })
  }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('baneado, fecha_liberacion, username, uniform, aprobado, club_id')
    .eq('id', user.id)
    .single()

  if (!profile?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = profile.club_id

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
    .eq('club_id', clubId)
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  const ventana = calcularVentanaPartido(partido)
  if (!ventana.abierta) {
    return NextResponse.json({ error: 'Las inscripciones no están abiertas para este partido.' }, { status: 400 })
  }

  // Check not already inscribed
  const { data: yaInscrito, error: checkErr } = await admin
    .from('inscripciones')
    .select('id, estado')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .single()

  if (checkErr && checkErr.code !== 'PGRST116') return NextResponse.json({ error: 'Error verificando inscripción.' }, { status: 500 })

  if (yaInscrito) {
    return NextResponse.json(
      { error: `Ya estás inscrito en este partido (${yaInscrito.estado})` },
      { status: 409 }
    )
  }

  const [{ count: totalJugadores }, { count: totalInvitados }, { data: uniformSetting }] = await Promise.all([
    admin.from('inscripciones').select('id', { count: 'exact', head: true }).eq('partido_id', partido_id).eq('estado', 'confirmado'),
    admin.from('invitados').select('id', { count: 'exact', head: true }).eq('partido_id', partido_id).eq('estado', 'confirmado'),
    admin.from('app_settings').select('value').eq('club_id', clubId).eq('key', 'usar_uniforme').maybeSingle(),
  ])

  const totalConfirmados = (totalJugadores ?? 0) + (totalInvitados ?? 0)

  // Check club setting: uniform priority enabled?
  const usarUniforme = uniformSetting === null || (uniformSetting as { value: unknown })?.value !== false

  const tieneUniforme = usarUniforme ? ((profile as { uniform?: boolean })?.uniform ?? false) : true
  const spotsLibres = totalConfirmados < partido.cupos_total

  // Admin alert → immediate, channel-gated (push on, email off by default).
  const pushAdmins = async (titulo: string, cuerpo: string) => {
    await notifyAdmins(admin, clubId, 'inscripcion', titulo, cuerpo)
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
    const { error } = await admin.from('inscripciones').insert({ club_id: clubId, partido_id, player_id: user.id, estado: 'confirmado' })
    if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

    // ── Race reconciliation ──────────────────────────────────────────────────
    // Two simultaneous signups can both pass the capacity check (TOCTOU) and
    // both insert as confirmado. Recount now; if over capacity, demote the
    // LAST confirmado (by created_at, id) — both racers compute the same loser,
    // so exactly one row ends up in espera regardless of interleaving.
    const [{ data: confirmadosNow }, { count: invNow }] = await Promise.all([
      admin.from('inscripciones')
        .select('id, player_id, created_at')
        .eq('partido_id', partido_id)
        .eq('estado', 'confirmado')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      admin.from('invitados').select('id', { count: 'exact', head: true })
        .eq('partido_id', partido_id).eq('estado', 'confirmado'),
    ])
    const overBy = ((confirmadosNow?.length ?? 0) + (invNow ?? 0)) - partido.cupos_total
    if (overBy > 0 && confirmadosNow && confirmadosNow.length > 0) {
      const losers = confirmadosNow.slice(-overBy)
      for (const loser of losers) {
        const { error: rpcErr } = await admin.rpc('incrementar_posiciones_espera', { p_partido_id: partido_id })
        if (rpcErr) console.error('[inscripciones] race-demote incrementar failed:', rpcErr.message)
        await admin.from('inscripciones').update({ estado: 'espera', posicion_espera: 1 }).eq('id', loser.id).eq('estado', 'confirmado')
      }
      const yoDemovido = losers.some(l => l.player_id === user.id)
      if (yoDemovido) {
        await logActivity({ user_id: user.id, username: profile.username, accion: 'inscripcion', detalles: { partido_id, fecha: partido.fecha, estado: 'espera', razon: 'cupo_lleno_carrera' } })
        await pushAdmins('⏳ Nueva inscripción (espera)', `${profile.username} en lista de espera — ${dia}`)
        return NextResponse.json({ estado: 'espera', posicion_espera: 1 })
      }
    }

    await logActivity({ user_id: user.id, username: profile.username, accion: 'inscripcion', detalles: { partido_id, fecha: partido.fecha, estado: 'confirmado' } })
    await pushAdmins('✅ Nueva inscripción', `${profile.username} se inscribió (confirmado) — ${dia}`)
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
      const { error: rpcErr } = await admin.rpc('incrementar_posiciones_espera', { p_partido_id: partido_id })
      if (rpcErr) console.error('[inscripciones] incrementar_posiciones_espera failed:', rpcErr.message)
      const { error: bumpErr } = await admin.from('inscripciones').update({ estado: 'espera', posicion_espera: 1 }).eq('id', toBump.id)
      if (bumpErr) console.error('[inscripciones] bump update failed:', bumpErr.message)
      const { error } = await admin.from('inscripciones').insert({ club_id: clubId, partido_id, player_id: user.id, estado: 'confirmado' })
      if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
      await logActivity({ user_id: user.id, username: profile.username, accion: 'inscripcion', detalles: { partido_id, fecha: partido.fecha, estado: 'confirmado_prioridad' } })
      await logActivity({ user_id: toBump.player_id, accion: 'bumped_espera', detalles: { partido_id, fecha: partido.fecha, bumped_by: profile.username } })
      await pushAdmins('✅ Nueva inscripción (uniforme)', `${profile.username} entró confirmado — ${dia}`)
      return NextResponse.json({ estado: 'confirmado', prioridad: true })
    }
    // All confirmed slots taken by uniformed players → fall through to espera
  }

  // Fall-through: go to waiting list
  const { data: posicion, error: posErr } = await admin.rpc('siguiente_posicion_espera', { p_partido_id: partido_id })
  if (posErr) console.error('[inscripciones] siguiente_posicion_espera failed:', posErr.message)
  const { error } = await admin.from('inscripciones').insert({
    club_id: clubId, partido_id, player_id: user.id, estado: 'espera', posicion_espera: posicion
  })
  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
  await logActivity({ user_id: user.id, username: profile.username, accion: 'inscripcion', detalles: { partido_id, fecha: partido.fecha, estado: 'espera', posicion_espera: posicion } })
  await pushAdmins('⏳ Nueva inscripción (espera)', `${profile.username} en lista de espera #${posicion} — ${dia}`)
  return NextResponse.json({ estado: 'espera', posicion_espera: posicion })
}

// DELETE /api/inscripciones — cancelar inscripción
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profileForClub } = await admin.from('profiles').select('club_id').eq('id', user.id).single()
  if (!profileForClub?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = profileForClub.club_id

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
    admin.from('profiles').select('username, club_id').eq('id', user.id).single(),
    admin.from('partidos').select('fecha, dia_semana').eq('id', partido_id as string).single(),
  ])
  const bajaClubId = (playerProfile as { club_id?: string } | null)?.club_id

  await admin.from('inscripciones').delete().eq('id', inscripcion.id)

  const username = (playerProfile as { username?: string } | null)?.username ?? 'Un jugador'
  const dia = (partidoInfo as { dia_semana?: string } | null)?.dia_semana ?? ''
  const estado = inscripcion.estado === 'confirmado' ? 'confirmado' : 'lista de espera'

  let promovidosNames: string[] = []
  if (inscripcion.estado === 'confirmado') {
    const { error: promErr } = await admin.rpc('promover_espera', { p_partido_id: partido_id })
    if (promErr) console.error('[inscripciones] promover_espera failed:', promErr.message)
    // Find who got promoted: query notificaciones_pendientes for this partido (unsent rows)
    const { data: pendientes } = await admin
      .from('notificaciones_pendientes')
      .select('username')
      .eq('partido_id', partido_id)
      .eq('enviado', false)
    promovidosNames = (pendientes ?? []).map((p: { username: string }) => p.username)
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

  // Admin alert → batched into the digest (one summary via cron, not per-baja)
  const promoBody = promovidosNames.length
    ? ` → ${promovidosNames.join(', ')} promovido${promovidosNames.length > 1 ? 's' : ''}`
    : ''
  const bajaMsg = `${username} se retiró (${estado})${dia ? ` — ${dia}` : ''}${promoBody}`
  if (bajaClubId) await notifyAdmins(admin, bajaClubId, 'baja', '⚠️ Baja en el partido', bajaMsg)

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush, isDeadPushError } from '@/lib/push'
import { calcularVentanaPartido } from '@/lib/partidos'
import { logActivity } from '@/lib/activityLog'
import { sendAperturaEmail, sendRecordatorioEmail } from '@/lib/email'
import { tallyAndAssign } from '@/app/api/evaluaciones/route'
import { channelsFor } from '@/lib/notifications'
import { applyMatchRatings } from '@/lib/rating'

// Every-minute cron metronome — pg_cron fires every minute, all timing logic lives here.
// Handles 5 tasks in one pass:
//   1. Apertura: fires 5 min before inscription window opens (or admin-set timestamp)
//   2. Día-antes reminder to confirmed players 1 day before match
//   3. Recordatorio: fires 9 hours before match (or admin-set timestamp) to confirmed players
//   4. Cupos disponibles push to non-inscribed club players
//   5. Drain notificaciones_pendientes (promotion emails/push)

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return false
  return true
}

async function sendToMany(
  admin: ReturnType<typeof createAdminClient>,
  subs: { endpoint: string; p256dh: string; auth: string }[],
  payload: { title: string; body: string; url?: string }
): Promise<number> {
  const results = await Promise.allSettled(
    subs.map(sub =>
      sendPush(sub, payload)
        .then(() => 1 as const)
        .catch(async (err: unknown) => {
          if (isDeadPushError(err)) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          } else {
            console.error('[cron/notificaciones] sendPush failed:', err)
          }
          return 0 as const
        })
    )
  )
  return results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0)
}

// ── Per-club helpers (cached within one cron run) ──────────────────────────
type AdminClient = ReturnType<typeof createAdminClient>
type Settings = Record<string, unknown>

async function getClubSettings(
  admin: AdminClient,
  clubId: string,
  cache: Map<string, Settings>
): Promise<Settings> {
  if (cache.has(clubId)) return cache.get(clubId)!
  const { data } = await admin.from('app_settings').select('key, value').eq('club_id', clubId)
  // Keep RAW values: booleans stay booleans, strings (e.g. hora_promo_invitados)
  // stay strings — the old `=== true` coercion destroyed string settings.
  const s: Settings = {}
  for (const row of data ?? []) s[(row as { key: string }).key] = (row as { value: unknown }).value
  cache.set(clubId, s)
  return s
}

async function getClubPlayerIds(
  admin: AdminClient,
  clubId: string,
  cache: Map<string, string[]>
): Promise<string[]> {
  if (cache.has(clubId)) return cache.get(clubId)!
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('club_id', clubId)
    .eq('aprobado', true)
    .eq('baneado', false)
  const ids = (data ?? []).map((p: { id: string }) => p.id)
  cache.set(clubId, ids)
  return ids
}

async function getClubNombreById(
  admin: AdminClient,
  clubId: string,
  cache: Map<string, string>
): Promise<string> {
  if (cache.has(clubId)) return cache.get(clubId)!
  const { data } = await admin.from('clubs').select('nombre').eq('id', clubId).single()
  const nombre = (data as { nombre?: string } | null)?.nombre ?? 'MBA Fútbol Club'
  cache.set(clubId, nombre)
  return nombre
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const now = new Date()
  const hoy = now.toISOString().split('T')[0]

  // mañana in Colombia time
  const manana = new Date(now)
  manana.setDate(now.getDate() + 1)
  const mananaStr = manana.toISOString().split('T')[0]

  const results = {
    apertura: 0, apertura_email: 0,
    dia_antes: 0,
    recordatorio: 0, recordatorio_email: 0,
    cupos: 0,
    invitados: 0,
  }

  const settingsCache = new Map<string, Settings>()
  const playerIdsCache = new Map<string, string[]>()
  const clubNombreCache = new Map<string, string>()

  // ── Auto-open/close evaluaciones ─────────────────────────────────────────
  const ayer = new Date(now); ayer.setDate(now.getDate() - 1)
  const ayerStr = ayer.toISOString().split('T')[0]
  const dosDiasAtras = new Date(now); dosDiasAtras.setDate(now.getDate() - 2)
  const dosDiasAtrasStr = dosDiasAtras.toISOString().split('T')[0]

  const { data: pasados } = await admin
    .from('partidos')
    .select('id, fecha, evaluaciones_abiertas, evaluaciones_ya_abiertas, equipos_confirmados')
    .in('fecha', [ayerStr, dosDiasAtrasStr])

  for (const p of pasados ?? []) {
    // Auto-open only once, ever. `evaluaciones_ya_abiertas` is what makes an
    // admin's close final — without it this ran every minute and reopened them.
    if (p.fecha === ayerStr && !(p.evaluaciones_abiertas as boolean) && !(p.evaluaciones_ya_abiertas as boolean)) {
      // Auto-open if at least 4 confirmed players (real match happened)
      const { count: insCount } = await admin
        .from('inscripciones')
        .select('id', { count: 'exact', head: true })
        .eq('partido_id', p.id)
        .eq('estado', 'confirmado')
      if ((insCount ?? 0) >= 4) {
        await admin.from('partidos').update({ evaluaciones_abiertas: true, evaluaciones_ya_abiertas: true }).eq('id', p.id)
        await logActivity({ accion: 'auto_abrir_evaluaciones', detalles: { partido_id: p.id, fecha: p.fecha, confirmados: insCount } })
      }
    }
    if (p.fecha === dosDiasAtrasStr && (p.evaluaciones_abiertas as boolean)) {
      await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', p.id)
      const { badges_asignados } = await tallyAndAssign(admin, p.id)
      // Recognitions are final — apply rating deltas (no-op without a result).
      try { await applyMatchRatings(admin, p.id) } catch (e) { console.error('[rating] cron auto_cerrar:', e) }
      await logActivity({ accion: 'auto_cerrar_evaluaciones', detalles: { partido_id: p.id, fecha: p.fecha, badges_asignados } })
    }
  }

  // ── Apertura notifications ────────────────────────────────────────────────
  // Fires 5 minutes before the inscription window opens (or at admin-set timestamp).
  const APERTURA_OFFSET_MS = 5 * 60 * 1000 // notify 5 min before window opens

  const { data: aperturaCandidates } = await admin
    .from('partidos')
    .select('id, club_id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_apertura_at, tipo, lugar')
    .gte('fecha', hoy)
    .eq('notif_apertura_sent', false)
    .order('fecha', { ascending: true })
    .limit(20)

  const aperturaDue = (aperturaCandidates ?? []).filter(p => {
    const ts = (p as { notif_apertura_at?: string | null }).notif_apertura_at
    // target = admin-set timestamp if present, else (window open time − 5 min)
    const target = ts ? new Date(ts) : new Date(calcularVentanaPartido(p).abreEn.getTime() - APERTURA_OFFSET_MS)
    return now >= target
  })

  for (const partido of aperturaDue) {
    const clubId = (partido as { club_id: string }).club_id
    const clubPlayerIds = await getClubPlayerIds(admin, clubId, playerIdsCache)
    const clubNombre = await getClubNombreById(admin, clubId, clubNombreCache)
    const settings = await getClubSettings(admin, clubId, settingsCache)
    const ch = channelsFor(settings, 'apertura')
    const matchHora = partido.hora?.substring(0, 5) ?? '19:00'
    const lugar = (partido as { lugar?: string | null }).lugar
    const esMini = (partido as { tipo?: string }).tipo === 'minitorneo'
    const evento = esMini ? `Minitorneo del ${partido.dia_semana} 🏆` : `Partido del ${partido.dia_semana}`

    // Push → all club players
    if (ch.push) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('player_id', clubPlayerIds)

      results.apertura += await sendToMany(admin, subs ?? [], {
        title: '⚽ ¡Inscripciones abiertas!',
        body: `${evento}${lugar ? ` en 📍 ${lugar}` : ''}. ¡Corre a inscribirte!`,
        url: '/',
      })
    }

    // Email → approved club players
    if (ch.email) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('email, username')
        .eq('club_id', clubId)
        .eq('aprobado', true)
        .eq('baneado', false)
        .neq('role', 'admin')
      const sent = await Promise.allSettled(
        (profiles ?? []).map(p => sendAperturaEmail({
          email: (p as { email: string }).email,
          username: (p as { username: string }).username,
          diaSemana: partido.dia_semana,
          fechaPartido: partido.fecha,
          hora: matchHora,
          lugar,
          clubNombre,
        }))
      )
      results.apertura_email += sent.filter(r => r.status === 'fulfilled' && r.value.ok).length
    }

    await admin.from('partidos').update({ notif_apertura_sent: true }).eq('id', partido.id)

    // Close still-open evaluaciones from past matches
    const { data: evalAbiertas } = await admin
      .from('partidos')
      .select('id, fecha')
      .eq('club_id', clubId)
      .eq('evaluaciones_abiertas', true)
      .lt('fecha', hoy)
    for (const ep of evalAbiertas ?? []) {
      await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', ep.id)
      const { badges_asignados } = await tallyAndAssign(admin, ep.id)
      // Recognitions are final — apply rating deltas (no-op without a result).
      try { await applyMatchRatings(admin, ep.id) } catch (e) { console.error('[rating] cron auto_cerrar nueva_apertura:', e) }
      await logActivity({ accion: 'auto_cerrar_evaluaciones', detalles: { partido_id: ep.id, fecha: ep.fecha, razon: 'nueva_apertura', badges_asignados } })
    }
  }

  // ── Recordatorio notifications ────────────────────────────────────────────
  // Fires 9 hours before the match (or at admin-set timestamp).
  const RECORDATORIO_OFFSET_MS = 9 * 60 * 60 * 1000

  const { data: recordatorioCandidates } = await admin
    .from('partidos')
    .select('id, club_id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_recordatorio_at, tipo, lugar')
    .gte('fecha', hoy)
    .eq('notif_recordatorio_sent', false)
    .order('fecha', { ascending: true })
    .limit(20)

  const recordatorioDue = (recordatorioCandidates ?? []).filter(p => {
    const ts = (p as { notif_recordatorio_at?: string | null }).notif_recordatorio_at
    // target = admin-set timestamp if present, else (match start − 9 h)
    const target = ts ? new Date(ts) : new Date(calcularVentanaPartido(p).cierra.getTime() - RECORDATORIO_OFFSET_MS)
    return now >= target
  })

  for (const partido of recordatorioDue) {
    const clubId = (partido as { club_id: string }).club_id
    const settings = await getClubSettings(admin, clubId, settingsCache)
    const ch = channelsFor(settings, 'recordatorio')
    const clubNombre = await getClubNombreById(admin, clubId, clubNombreCache)
    const matchHora = partido.hora?.substring(0, 5) ?? '19:00'

    const { data: inscripciones } = await admin
      .from('inscripciones')
      .select('player_id')
      .eq('partido_id', partido.id)
      .eq('estado', 'confirmado')

    const confirmedIds = (inscripciones ?? []).map((i: { player_id: string }) => i.player_id)
    if (confirmedIds.length > 0) {
      // Push
      if (ch.push) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', confirmedIds)

        const recLugar = (partido as { lugar?: string | null }).lugar
        const recMini = (partido as { tipo?: string }).tipo === 'minitorneo'
        results.recordatorio += await sendToMany(admin, subs ?? [], {
          title: recMini ? '🏆 Minitorneo hoy' : '⏰ Partido hoy',
          body: `Recuerda: ${recMini ? 'minitorneo' : 'partido'} del ${partido.dia_semana} a las ${matchHora}${recLugar ? ` en 📍 ${recLugar}` : ''}. ¡Nos vemos!`,
          url: '/',
        })
      }

      // Email
      if (ch.email) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('email, username')
          .in('id', confirmedIds)
        const sent = await Promise.allSettled(
          (profiles ?? []).map(p => sendRecordatorioEmail({
            email: (p as { email: string }).email,
            username: (p as { username: string }).username,
            diaSemana: partido.dia_semana,
            hora: matchHora,
            lugar: (partido as { lugar?: string | null }).lugar,
            clubNombre,
          }))
        )
        results.recordatorio_email += sent.filter(r => r.status === 'fulfilled' && r.value.ok).length
      }
    }

    await admin.from('partidos').update({ notif_recordatorio_sent: true }).eq('id', partido.id)
  }

  // ── Load upcoming partidos for remaining checks (dia_antes, cupos, invitados) ─
  const { data: partidos } = await admin
    .from('partidos')
    .select('id, club_id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_dia_antes_sent, notif_cupos_sent, cupos_total, evaluaciones_abiertas, equipos_confirmados, tipo, lugar')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .limit(20)

  for (const partido of partidos ?? []) {
    const clubId = (partido as { club_id: string }).club_id
    const { abierta } = calcularVentanaPartido(partido)
    const matchHora = partido.hora?.substring(0, 5) ?? '19:00'

    const settings = await getClubSettings(admin, clubId, settingsCache)
    const clubPlayerIds = await getClubPlayerIds(admin, clubId, playerIdsCache)

    const sendDiaAntes  = settings['notif_dia_antes']  !== false
    const sendCupos     = settings['notif_cupos']      !== false
    const sendInvitados = settings['notif_invitados']  !== false

    // ── Día antes: tomorrow's match, not yet notified ──────────────────────
    if (sendDiaAntes && !(partido as { notif_dia_antes_sent?: boolean }).notif_dia_antes_sent && partido.fecha === mananaStr) {
      const { data: inscripciones } = await admin
        .from('inscripciones')
        .select('player_id')
        .eq('partido_id', partido.id)
        .eq('estado', 'confirmado')

      const confirmedIds = (inscripciones ?? []).map((i: { player_id: string }) => i.player_id)
      if (confirmedIds.length > 0) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', confirmedIds)

        const daLugar = (partido as { lugar?: string | null }).lugar
        results.dia_antes += await sendToMany(admin, subs ?? [], {
          title: '📅 Partido mañana',
          body: `Mañana a las ${matchHora} es el partido del ${partido.dia_semana}${daLugar ? ` en 📍 ${daLugar}` : ''}. ¿Vas a poder ir? Si no puedes, cancela tu cupo 🙏`,
          url: '/',
        })

        await admin.from('partidos').update({ notif_dia_antes_sent: true }).eq('id', partido.id)
      }
    }

    // ── Cupos disponibles — ONCE per partido, day-of, if still free ─────────
    // Guarded by notif_cupos_sent: cron runs every minute, without the flag this
    // push repeated per-minute while the window was open.
    const cuposSent = (partido as { notif_cupos_sent?: boolean }).notif_cupos_sent
    if (sendCupos && abierta && !cuposSent && partido.fecha === hoy) {
      const { count: confirmados } = await admin
        .from('inscripciones')
        .select('id', { count: 'exact', head: true })
        .eq('partido_id', partido.id)
        .eq('estado', 'confirmado')

      const cuposLibres = partido.cupos_total - (confirmados ?? 0)
      if (cuposLibres > 0) {
        const { data: inscritos } = await admin
          .from('inscripciones')
          .select('player_id')
          .eq('partido_id', partido.id)

        const inscritosIds = (inscritos ?? []).map((i: { player_id: string }) => i.player_id)

        // Push → club players NOT already on the list
        const subsQuery = admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', clubPlayerIds)

        const { data: subs } = inscritosIds.length > 0
          ? await (subsQuery as typeof subsQuery).not('player_id', 'in', `(${inscritosIds.join(',')})`)
          : await subsQuery

        results.cupos += await sendToMany(admin, subs ?? [], {
          title: '⚽ Cupos disponibles',
          body: `Quedan ${cuposLibres} cupo${cuposLibres !== 1 ? 's' : ''} para el partido del ${partido.dia_semana}. ¡Anótate antes de que se llene!`,
          url: '/',
        })
        await admin.from('partidos').update({ notif_cupos_sent: true }).eq('id', partido.id)
      }
    }

    // ── Invitee promotion: today's match, only from the club's promo hour ──
    // (default 2 PM Colombia; without this gate they promoted at midnight)
    const promoRaw = String(settings['hora_promo_invitados'] ?? '2:00 PM')
    const pm = promoRaw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i)
    let promoHour = 14
    if (pm) {
      promoHour = parseInt(pm[1], 10) % 12
      if ((pm[3] ?? 'PM').toUpperCase() === 'PM') promoHour += 12
    }
    const colHour = new Date(now.getTime() - 5 * 3600 * 1000).getUTCHours()
    if (sendInvitados && partido.fecha === hoy && colHour >= promoHour) {
      const { count: confirmados } = await admin
        .from('inscripciones')
        .select('id', { count: 'exact', head: true })
        .eq('partido_id', partido.id)
        .eq('estado', 'confirmado')

      const cuposLibres = partido.cupos_total - (confirmados ?? 0)
      if (cuposLibres > 0) {
        const { data: invitadosPendientes } = await admin
          .from('invitados')
          .select('id')
          .eq('partido_id', partido.id)
          .eq('estado', 'espera')
          .order('created_at', { ascending: true })
          .limit(cuposLibres)

        for (const inv of invitadosPendientes ?? []) {
          await admin.from('invitados').update({ estado: 'confirmado' }).eq('id', inv.id)
          results.invitados++
        }
      }
    }
  }

  // ── Drain notificaciones_pendientes (promotion emails/push) ──────────────
  const { data: pendientes } = await admin
    .from('notificaciones_pendientes')
    .select('id, player_id, email, username, fecha_partido, club_id')
    .eq('enviado', false)
    .order('created_at', { ascending: true })
    .limit(20)

  let promovidos_enviados = 0
  for (const notif of pendientes ?? []) {
    try {
      const fecha = new Date(notif.fecha_partido + 'T12:00:00')
      const diaSemana = fecha.toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' })
      const fechaFormateada = fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' })
      const { sendPromovido } = await import('@/lib/email')
      const notifClubId = (notif as Record<string, unknown>).club_id as string | undefined
      const notifClubNombre = notifClubId ? await getClubNombreById(admin, notifClubId, clubNombreCache) : 'MBA Fútbol Club'
      const emailResult = await sendPromovido({ email: notif.email, username: notif.username, fechaPartido: fechaFormateada, diaSemana, clubNombre: notifClubNombre })
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('player_id', notif.player_id)
      for (const sub of subs ?? []) {
        try {
          await sendPush(sub, { title: '¡Entraste al partido!', body: `Cupo confirmado para el ${diaSemana} ${fechaFormateada} ⚽`, url: '/' })
        } catch (err) {
          if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
      }
      await admin.from('notificaciones_pendientes').update({ enviado: true }).eq('id', notif.id)
      await logActivity({ user_id: notif.player_id, username: notif.username, accion: 'notif_promovido', detalles: { email: notif.email, email_ok: emailResult.ok, fecha_partido: notif.fecha_partido, via: 'cron' } })
      promovidos_enviados++
    } catch (err) {
      console.error('[cron] error draining notif', notif.id, err)
    }
  }

  const totalPush = results.apertura + results.dia_antes + results.recordatorio + results.cupos
  const totalEmail = results.apertura_email + results.recordatorio_email
  if (totalPush > 0 || totalEmail > 0 || results.invitados > 0 || promovidos_enviados > 0) {
    await logActivity({
      accion: 'cron_notificaciones',
      detalles: { ...results, total_push: totalPush, total_email: totalEmail, promovidos_enviados, timestamp: now.toISOString() },
    })
  }
  console.log('[cron/notificaciones]', now.toISOString(), { ...results, promovidos_enviados })
  return NextResponse.json({ ok: true, ...results, promovidos_enviados })
}

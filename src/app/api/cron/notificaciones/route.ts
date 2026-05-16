import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'
import { calcularVentanaPartido } from '@/lib/partidos'
import { logActivity } from '@/lib/activityLog'
import { sendAperturaEmail, sendRecordatorioEmail } from '@/lib/email'

// Single daily cron — runs at 15:00 UTC = 10:00 AM Colombia
// Handles 4 tasks in one pass:
//   1. Apertura notification → all users when inscription window opens (push + email)
//   2. Recordatorio → confirmed players ≤10h before match (push + email)
//   3. Cupos disponibles → non-inscribed users with spots remaining
//   4. Invitee promotion → promote waiting invitees if spots available

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('Authorization') === `Bearer ${secret}`
}

async function sendToMany(
  admin: ReturnType<typeof createAdminClient>,
  subs: { endpoint: string; p256dh: string; auth: string }[],
  payload: { title: string; body: string; url?: string }
): Promise<number> {
  let enviados = 0
  for (const sub of subs) {
    try {
      await sendPush(sub, payload)
      enviados++
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }
  }
  return enviados
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const now = new Date()
  const hoy = now.toISOString().split('T')[0]
  const results = { apertura: 0, apertura_email: 0, recordatorio: 0, recordatorio_email: 0, cupos: 0, invitados: 0 }

  // ── Load notification toggles from app_settings ──────────────────────────
  const { data: settingsRows } = await admin.from('app_settings').select('key, value')
  const settings: Record<string, boolean> = {}
  for (const row of (settingsRows ?? [])) {
    settings[(row as { key: string; value: unknown }).key] = (row as { key: string; value: unknown }).value === true
  }
  const sendApertura      = settings['notif_apertura']      !== false
  const sendRecordatorio  = settings['notif_recordatorio']  !== false
  const sendCupos         = settings['notif_cupos']         !== false
  const sendInvitados     = settings['notif_invitados']     !== false
  const emailApertura     = settings['email_apertura']      !== false
  const emailRecordatorio = settings['email_recordatorio']  !== false

  const { data: partidos } = await admin
    .from('partidos')
    .select('id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_apertura_sent, notif_recordatorio_sent, cupos_total, evaluaciones_abiertas, equipos_confirmados')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .limit(10)

  // ── Auto-open evaluaciones day after match, auto-close after 2 days ─────────
  const ayer = new Date(now); ayer.setDate(now.getDate() - 1)
  const ayerStr = ayer.toISOString().split('T')[0]
  const dosDiasAtras = new Date(now); dosDiasAtras.setDate(now.getDate() - 2)
  const dosDiasAtrasStr = dosDiasAtras.toISOString().split('T')[0]

  const { data: pasados } = await admin
    .from('partidos')
    .select('id, fecha, evaluaciones_abiertas, equipos_confirmados')
    .in('fecha', [ayerStr, dosDiasAtrasStr])

  for (const p of pasados ?? []) {
    if (p.fecha === ayerStr && (p.equipos_confirmados as boolean) && !(p.evaluaciones_abiertas as boolean)) {
      await admin.from('partidos').update({ evaluaciones_abiertas: true }).eq('id', p.id)
      await logActivity({ accion: 'auto_abrir_evaluaciones', detalles: { partido_id: p.id, fecha: p.fecha } })
    }
    if (p.fecha === dosDiasAtrasStr && (p.evaluaciones_abiertas as boolean)) {
      await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', p.id)
      await logActivity({ accion: 'auto_cerrar_evaluaciones', detalles: { partido_id: p.id, fecha: p.fecha } })
    }
  }

  for (const partido of partidos ?? []) {
    const { abierta, cierra } = calcularVentanaPartido(partido)
    const hoursToMatch = (cierra.getTime() - now.getTime()) / (1000 * 60 * 60)
    const matchHora = partido.hora?.substring(0, 5) ?? '19:00'

    // ── 1. Apertura: window just opened, not yet notified ────────────────────
    if (sendApertura && !partido.notif_apertura_sent && abierta) {
      // Push to all
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth')
      results.apertura += await sendToMany(admin, subs ?? [], {
        title: '⚽ ¡Inscripciones abiertas!',
        body: `Ya puedes anotarte para el partido del ${partido.dia_semana}. ¡Entra ahora!`,
        url: '/',
      })

      // Email to all approved players
      if (emailApertura) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('email, username')
          .eq('aprobado', true)
          .eq('baneado', false)
          .neq('role', 'admin')
        for (const p of (profiles ?? [])) {
          const r = await sendAperturaEmail({
            email: (p as { email: string }).email,
            username: (p as { username: string }).username,
            diaSemana: partido.dia_semana,
            fechaPartido: partido.fecha,
            hora: matchHora,
          })
          if (r.ok) results.apertura_email++
        }
      }

      await admin.from('partidos').update({ notif_apertura_sent: true }).eq('id', partido.id)
    }

    // ── 2. Recordatorio: match in ≤10h, not yet notified ─────────────────────
    // Window extended to 10h (cron at 10am catches 7pm+ matches)
    if (sendRecordatorio && !partido.notif_recordatorio_sent && hoursToMatch > 0 && hoursToMatch <= 10) {
      const { data: inscripciones } = await admin
        .from('inscripciones')
        .select('player_id')
        .eq('partido_id', partido.id)
        .eq('estado', 'confirmado')

      const confirmedIds = (inscripciones ?? []).map((i: { player_id: string }) => i.player_id)
      if (confirmedIds.length > 0) {
        // Push
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', confirmedIds)

        results.recordatorio += await sendToMany(admin, subs ?? [], {
          title: '⏰ Recordatorio de partido',
          body: `Hoy a las ${matchHora} es el partido del ${partido.dia_semana}. Si no puedes ir, cancela tu cupo 🙏`,
          url: '/',
        })

        // Email
        if (emailRecordatorio) {
          const { data: profiles } = await admin
            .from('profiles')
            .select('email, username')
            .in('id', confirmedIds)
          for (const p of (profiles ?? [])) {
            const r = await sendRecordatorioEmail({
              email: (p as { email: string }).email,
              username: (p as { username: string }).username,
              diaSemana: partido.dia_semana,
              hora: matchHora,
            })
            if (r.ok) results.recordatorio_email++
          }
        }

        await admin.from('partidos').update({ notif_recordatorio_sent: true }).eq('id', partido.id)
      }
    }

    // ── 3. Cupos disponibles ──────────────────────────────────────────────────
    if (sendCupos && abierta) {
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

        const subsQuery = admin.from('push_subscriptions').select('endpoint, p256dh, auth')
        const { data: subs } = inscritosIds.length > 0
          ? await subsQuery.not('player_id', 'in', inscritosIds)
          : await subsQuery

        results.cupos += await sendToMany(admin, subs ?? [], {
          title: '⚽ Cupos disponibles',
          body: `Quedan ${cuposLibres} cupo${cuposLibres !== 1 ? 's' : ''} para el partido del ${partido.dia_semana}. ¡Anótate antes de que se llene!`,
          url: '/',
        })
      }
    }

    // ── 4. Invitee promotion: today's match at 10am ───────────────────────────
    if (sendInvitados && partido.fecha === hoy) {
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

  // ── 5. Drain notificaciones_pendientes (promotion emails/push) ───────────────
  // Safety net: any rows left enviado=false get processed here even if the
  // fire-and-forget internalFetch('/api/notify') failed earlier.
  const { data: pendientes } = await admin
    .from('notificaciones_pendientes')
    .select('*')
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
      const { sendPush } = await import('@/lib/push')
      const emailResult = await sendPromovido({ email: notif.email, username: notif.username, fechaPartido: fechaFormateada, diaSemana })
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('player_id', notif.player_id)
      for (const sub of subs ?? []) {
        try {
          await sendPush(sub, { title: '¡Entraste al partido!', body: `Cupo confirmado para el ${diaSemana} ${fechaFormateada} ⚽`, url: '/' })
        } catch { /* expired sub */ }
      }
      await admin.from('notificaciones_pendientes').update({ enviado: true }).eq('id', notif.id)
      await logActivity({ user_id: notif.player_id, username: notif.username, accion: 'notif_promovido', detalles: { email: notif.email, email_ok: emailResult.ok, fecha_partido: notif.fecha_partido, via: 'cron' } })
      promovidos_enviados++
    } catch (err) {
      console.error('[cron] error draining notif', notif.id, err)
    }
  }

  const totalPush = results.apertura + results.recordatorio + results.cupos
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

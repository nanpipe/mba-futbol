import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'
import { calcularVentanaPartido } from '@/lib/partidos'
import { logActivity } from '@/lib/activityLog'

// Single daily cron — runs at 19:00 UTC = 2:00 PM Colombia
// Handles 4 tasks in one pass:
//   1. Apertura notification → all users when inscription window opens
//   2. Recordatorio → confirmed players ~5h before match
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
  const results = { apertura: 0, recordatorio: 0, cupos: 0, invitados: 0 }

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
    if (!partido.notif_apertura_sent && abierta) {
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth')
      results.apertura += await sendToMany(admin, subs ?? [], {
        title: '⚽ ¡Inscripciones abiertas!',
        body: `Ya puedes anotarte para el partido del ${partido.dia_semana}. ¡Entra ahora!`,
        url: '/',
      })
      await admin.from('partidos').update({ notif_apertura_sent: true }).eq('id', partido.id)
    }

    // ── 2. Recordatorio: match in <8h, not yet notified ──────────────────────
    if (!partido.notif_recordatorio_sent && hoursToMatch > 0 && hoursToMatch <= 8) {
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

        results.recordatorio += await sendToMany(admin, subs ?? [], {
          title: '⏰ Recordatorio de partido',
          body: `Hoy a las ${matchHora} es el partido del ${partido.dia_semana}. Si no puedes ir, cancela tu cupo para que otro jugador pueda entrar 🙏`,
          url: '/',
        })
        await admin.from('partidos').update({ notif_recordatorio_sent: true }).eq('id', partido.id)
      }
    }

    // ── 3. Cupos disponibles ──────────────────────────────────────────────────
    if (abierta) {
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
        // Use array parameter (not string interpolation) to avoid injection
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

    // ── 4. Invitee promotion: today's match at 2pm ────────────────────────────
    if (partido.fecha === hoy) {
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

  const totalPush = results.apertura + results.recordatorio + results.cupos
  if (totalPush > 0 || results.invitados > 0) {
    await logActivity({
      accion: 'cron_notificaciones',
      detalles: { ...results, total_push: totalPush, timestamp: now.toISOString() },
    })
  }
  console.log('[cron/notificaciones]', now.toISOString(), results)
  return NextResponse.json({ ok: true, ...results })
}

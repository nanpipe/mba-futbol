import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'
import { calcularVentanaPartido } from '@/lib/partidos'

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: no secret needed
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

// GET /api/cron/check — runs every hour via Vercel Cron
// Handles two checks:
//   1. Inscription window just opened → notify ALL users
//   2. Match starting in ~9 hours → remind CONFIRMED players to cancel if they can't attend
export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const now = new Date()
  const hoy = now.toISOString().split('T')[0]
  const results = { apertura: 0, recordatorio: 0 }

  const { data: partidos } = await admin
    .from('partidos')
    .select('id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_apertura_sent, notif_recordatorio_sent')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .limit(10)

  for (const partido of partidos ?? []) {
    const { abierta, cierra } = calcularVentanaPartido(partido)
    const hoursToMatch = (cierra.getTime() - now.getTime()) / (1000 * 60 * 60)

    // ── CHECK 1: inscription window just opened ──────────────────────────────
    if (!partido.notif_apertura_sent && abierta) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')

      const enviados = await sendToMany(admin, subs ?? [], {
        title: '⚽ ¡Inscripciones abiertas!',
        body: `Ya puedes anotarte para el partido del ${partido.dia_semana}. ¡Entra ahora!`,
        url: '/',
      })

      await admin.from('partidos').update({ notif_apertura_sent: true }).eq('id', partido.id)
      results.apertura += enviados
    }

    // ── CHECK 2: match ~9 hours away → remind confirmed players ─────────────
    if (!partido.notif_recordatorio_sent && hoursToMatch > 0 && hoursToMatch <= 9.5 && hoursToMatch >= 8) {
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

        const matchHora = partido.hora?.substring(0, 5) ?? '19:00'
        const enviados = await sendToMany(admin, subs ?? [], {
          title: '⏰ Recordatorio de partido',
          body: `Hoy a las ${matchHora} es el partido del ${partido.dia_semana}. Si no puedes ir, cancela tu cupo para que otro jugador pueda entrar 🙏`,
          url: '/',
        })

        await admin.from('partidos').update({ notif_recordatorio_sent: true }).eq('id', partido.id)
        results.recordatorio += enviados
      }
    }
  }

  console.log('[cron/check]', new Date().toISOString(), results)
  return NextResponse.json({ ok: true, ...results })
}

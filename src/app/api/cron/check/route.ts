import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush, isDeadPushError } from '@/lib/push'
import { calcularVentanaPartido } from '@/lib/partidos'
import { sendAperturaEmail, sendRecordatorioEmail } from '@/lib/email'

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
  let enviados = 0
  for (const sub of subs) {
    try {
      await sendPush(sub, payload)
      enviados++
    } catch (err: unknown) {
      if (isDeadPushError(err)) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      } else {
        console.error('[cron/check] sendPush failed:', err)
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
    .select('id, club_id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_apertura_sent, notif_recordatorio_sent')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .limit(10)

  for (const partido of partidos ?? []) {
    const { abierta, cierra } = calcularVentanaPartido(partido)
    const hoursToMatch = (cierra.getTime() - now.getTime()) / (1000 * 60 * 60)

    // ── CHECK 1: inscription window just opened ──────────────────────────────
    if (!partido.notif_apertura_sent && abierta) {
      // Scope to this partido's club only (was leaking across all clubs)
      const { data: clubProfiles } = await admin
        .from('profiles')
        .select('id, email, username')
        .eq('club_id', (partido as { club_id?: string }).club_id ?? '')
        .eq('aprobado', true)
        .eq('baneado', false)
        .neq('role', 'admin')
      const clubPlayerIds = (clubProfiles ?? []).map((p: { id: string }) => p.id)

      if (clubPlayerIds.length > 0) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', clubPlayerIds)

        const enviados = await sendToMany(admin, subs ?? [], {
          title: '⚽ ¡Inscripciones abiertas!',
          body: `Ya puedes anotarte para el partido del ${partido.dia_semana}. ¡Entra ahora!`,
          url: '/',
        })
        results.apertura += enviados

        // Email club players too
        const matchHora = partido.hora?.substring(0, 5) ?? '19:00'
        for (const p of (clubProfiles ?? []) as { email?: string; username?: string }[]) {
          if (!p.email) continue
          try {
            await sendAperturaEmail({ email: p.email, username: p.username ?? '', diaSemana: partido.dia_semana, fechaPartido: partido.fecha, hora: matchHora })
          } catch (err) { console.error('[cron/check] apertura email failed:', err) }
        }
      }

      await admin.from('partidos').update({ notif_apertura_sent: true }).eq('id', partido.id)
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

        // Email confirmed players too
        const { data: confProfiles } = await admin
          .from('profiles').select('email, username').in('id', confirmedIds)
        for (const p of (confProfiles ?? []) as { email?: string; username?: string }[]) {
          if (!p.email) continue
          try {
            await sendRecordatorioEmail({ email: p.email, username: p.username ?? '', diaSemana: partido.dia_semana, hora: matchHora })
          } catch (err) { console.error('[cron/check] recordatorio email failed:', err) }
        }

        await admin.from('partidos').update({ notif_recordatorio_sent: true }).eq('id', partido.id)
        results.recordatorio += enviados
      }
    }
  }

  console.log('[cron/check]', new Date().toISOString(), results)
  return NextResponse.json({ ok: true, ...results })
}

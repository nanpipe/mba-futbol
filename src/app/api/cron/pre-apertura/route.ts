import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush, isDeadPushError } from '@/lib/push'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return false
  return true
}

// Called every minute by pg_cron.
// Sends "5-minute warning" push to all club players before inscriptions open.
// Handles multiple clubs — processes all partidos returned by the RPC.
export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Find partidos whose inscription window opens in 4–6 minutes
  const { data: partidos } = await admin.rpc('partidos_pre_apertura')

  if (!partidos?.length) return NextResponse.json({ ok: true, enviados: 0 })

  let totalEnviados = 0

  for (const partido of partidos as { id: string; club_id: string; dia_semana: string; hora_apertura: string }[]) {
    // Get all approved, non-banned players from this club
    const { data: clubProfiles } = await admin
      .from('profiles')
      .select('id')
      .eq('club_id', partido.club_id)
      .eq('aprobado', true)
      .eq('baneado', false)

    const clubPlayerIds = (clubProfiles ?? []).map((p: { id: string }) => p.id)
    if (clubPlayerIds.length === 0) continue

    // Push only to that club's subscribed players
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('player_id', clubPlayerIds)

    let enviados = 0
    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, {
          title: '⏳ ¡Inscripciones en 5 minutos!',
          body: `Las inscripciones para el partido del ${partido.dia_semana} abren en 5 minutos. ¡Prepárate!`,
          url: '/',
        })
        enviados++
      } catch (err: unknown) {
        if (isDeadPushError(err)) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        } else {
          console.error('[cron/pre-apertura] sendPush failed:', err)
        }
      }
    }

    // Mark as sent so it doesn't fire again this minute
    await admin
      .from('partidos')
      .update({ notif_pre_apertura_sent: true })
      .eq('id', partido.id)

    await logActivity({
      accion: 'cron_pre_apertura',
      detalles: { partido_id: partido.id, club_id: partido.club_id, dia_semana: partido.dia_semana, enviados },
    })

    totalEnviados += enviados
  }

  return NextResponse.json({ ok: true, enviados: totalEnviados })
}

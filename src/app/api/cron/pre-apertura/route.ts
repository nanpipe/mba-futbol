import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('Authorization') === `Bearer ${secret}`
}

// Called every minute by pg_cron.
// Sends a "5-minute warning" push to all players before inscriptions open.
export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Find partidos whose inscription window opens in 4–6 minutes (Colombia time)
  // apertura datetime = (fecha - dias_antes_apertura days) at hora_apertura (America/Bogota)
  const { data: partidos } = await admin.rpc('partidos_pre_apertura')

  if (!partidos?.length) return NextResponse.json({ ok: true, enviados: 0 })

  const partido = partidos[0] as {
    id: string
    dia_semana: string
    hora_apertura: string
  }

  // Push to all approved, non-banned players
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')

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
      if ((err as { statusCode?: number }).statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }
  }

  // Mark as sent so it doesn't fire again
  await admin
    .from('partidos')
    .update({ notif_pre_apertura_sent: true })
    .eq('id', partido.id)

  await logActivity({
    accion: 'cron_pre_apertura',
    detalles: { partido_id: partido.id, dia_semana: partido.dia_semana, enviados },
  })

  return NextResponse.json({ ok: true, enviados, partido_id: partido.id })
}

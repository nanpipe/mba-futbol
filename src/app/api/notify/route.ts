import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPromovido } from '@/lib/email'
import { sendPush } from '@/lib/push'
import { verifyInternalSecret } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'

// POST /api/notify — procesa notificaciones pendientes en la cola
// Only callable internally (server-to-server) via X-Internal-Secret header
export async function POST(req: NextRequest) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()

  const { data: pendientes } = await admin
    .from('notificaciones_pendientes')
    .select('*')
    .eq('enviado', false)
    .order('created_at', { ascending: true })
    .limit(10)

  if (!pendientes || pendientes.length === 0) {
    return NextResponse.json({ enviados: 0 })
  }

  let enviados = 0

  for (const notif of pendientes) {
    try {
      const fecha = new Date(notif.fecha_partido)
      const diaSemana = fecha.toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' })
      const fechaFormateada = fecha.toLocaleDateString('es-CO', {
        day: 'numeric', month: 'long', timeZone: 'America/Bogota'
      })

      // Email
      const emailResult = await sendPromovido({
        email: notif.email,
        username: notif.username,
        fechaPartido: fechaFormateada,
        diaSemana,
      })

      // Push — enviar a todas las suscripciones del jugador
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('player_id', notif.player_id)

      let pushEnviados = 0
      for (const sub of subs ?? []) {
        try {
          await sendPush(sub, {
            title: '¡Entraste al partido!',
            body: `Tienes cupo confirmado para el ${diaSemana} ${fechaFormateada}. ¡Nos vemos en la cancha! ⚽`,
            url: '/',
          })
          pushEnviados++
        } catch (pushErr: unknown) {
          // Subscription expirada — eliminar
          if ((pushErr as { statusCode?: number }).statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        }
      }

      await admin
        .from('notificaciones_pendientes')
        .update({ enviado: true })
        .eq('id', notif.id)

      await logActivity({
        user_id: notif.player_id,
        username: notif.username,
        accion: 'notif_promovido',
        detalles: {
          email: notif.email,
          email_ok: emailResult.ok,
          email_id: emailResult.id ?? null,
          email_error: emailResult.error ?? null,
          push_enviados: pushEnviados,
          fecha_partido: notif.fecha_partido,
        },
      })

      enviados++
    } catch (err) {
      console.error('Error enviando notificación:', notif.id, err)
    }
  }

  return NextResponse.json({ enviados })
}

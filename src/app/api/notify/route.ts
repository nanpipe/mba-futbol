import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPromovido } from '@/lib/email'
import { sendPush } from '@/lib/push'

// POST /api/notify — procesa notificaciones pendientes en la cola
export async function POST() {
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
      await sendPromovido({
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

      for (const sub of subs ?? []) {
        try {
          await sendPush(sub, {
            title: '¡Entraste al partido!',
            body: `Tienes cupo confirmado para el ${diaSemana} ${fechaFormateada}. ¡Nos vemos en la cancha! ⚽`,
            url: '/',
          })
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

      enviados++
    } catch (err) {
      console.error('Error enviando notificación:', notif.id, err)
    }
  }

  return NextResponse.json({ enviados })
}

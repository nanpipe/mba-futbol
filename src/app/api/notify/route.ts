import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPromovido } from '@/lib/email'

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

      await sendPromovido({
        email: notif.email,
        username: notif.username,
        fechaPartido: fechaFormateada,
        diaSemana,
      })

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

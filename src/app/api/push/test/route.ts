import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'

export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  // Verify via JWT token (reliable across cookies/environments)
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (prof?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { title, body, player_id } = await req.json()

  let query = admin.from('push_subscriptions').select('endpoint, p256dh, auth')
  if (player_id) query = (query as typeof query).eq('player_id', player_id)
  const { data: subs } = await query

  if (!subs || subs.length === 0) {
    return NextResponse.json({ error: 'No hay suscripciones activas. El jugador debe activar notificaciones primero.' }, { status: 404 })
  }

  let enviados = 0
  for (const sub of subs) {
    try {
      await sendPush(sub, { title: title || 'MBA FC', body: body || 'Notificación de prueba ⚽', url: '/' })
      enviados++
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }
  }

  return NextResponse.json({ ok: true, enviados, mensaje: `Enviado a ${enviados} dispositivo(s).` })
}

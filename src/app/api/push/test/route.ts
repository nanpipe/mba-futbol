import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'

export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (prof?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let parsed: Record<string, unknown>
  try { parsed = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const title = typeof parsed.title === 'string' ? parsed.title.slice(0, 256) : 'MBA FC'
  const body = typeof parsed.body === 'string' ? parsed.body.slice(0, 512) : 'Notificación de prueba ⚽'
  const player_id = typeof parsed.player_id === 'string' ? parsed.player_id : undefined

  let query = admin.from('push_subscriptions').select('endpoint, p256dh, auth, player_id')
  if (player_id) query = (query as typeof query).eq('player_id', player_id)
  const { data: subs } = await query

  if (!subs || subs.length === 0) {
    return NextResponse.json({ error: 'No hay suscripciones activas. El jugador debe activar notificaciones primero.' }, { status: 404 })
  }

  let enviados = 0
  const errores: string[] = []

  for (const sub of subs) {
    try {
      await sendPush(sub, { title: title || 'MBA FC', body: body || 'Notificación de prueba ⚽', url: '/' })
      enviados++
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode
      const body = (err as { body?: string }).body

      if (status === 410 || status === 404) {
        // Subscription expired — clean it up
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        errores.push(`Suscripción expirada eliminada (${status})`)
      } else if (status === 401) {
        errores.push(`VAPID key incorrecta o suscripción creada con una clave anterior. El usuario debe desactivar y reactivar notificaciones. (401)`)
      } else {
        errores.push(`Error ${status ?? 'desconocido'}: ${body ?? String(err)}`)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    enviados,
    errores,
    mensaje: enviados > 0
      ? `Enviado a ${enviados} dispositivo(s).`
      : `No se pudo enviar. ${errores[0] ?? 'Error desconocido.'}`,
  }, { status: enviados > 0 || errores.length === 0 ? 200 : 400 })
}

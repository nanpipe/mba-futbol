import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush } from '@/lib/push'
import { logActivity } from '@/lib/activityLog'
import { getClubNombre } from '@/lib/club'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role, club_id').eq('id', user.id).single()
  if (prof?.role !== 'admin' && prof?.role !== 'superadmin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const clubId = (prof as { club_id?: string })?.club_id
  if (!clubId) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })

  let parsed: Record<string, unknown>
  try { parsed = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const clubNombre = getClubNombre(req)
  const title = typeof parsed.title === 'string' ? parsed.title.slice(0, 256) : clubNombre
  const body = typeof parsed.body === 'string' ? parsed.body.slice(0, 512) : 'Notificación de prueba ⚽'
  const player_id = typeof parsed.player_id === 'string' ? parsed.player_id : undefined
  const group = typeof parsed.group === 'string' ? parsed.group : undefined
  const partido_id = typeof parsed.partido_id === 'string' ? parsed.partido_id : undefined

  // Resolve group → player_ids
  let groupPlayerIds: string[] | null = null
  // Every branch is scoped to the caller's club: the title and body are
  // caller-supplied, so an unscoped target let one club push arbitrary text to
  // another club's players.
  const partidoDelClub = partido_id
    ? !!(await admin.from('partidos').select('id').eq('id', partido_id).eq('club_id', clubId).maybeSingle()).data
    : false

  if (group === 'admins') {
    const { data } = await admin.from('profiles').select('id').eq('club_id', clubId).in('role', ['admin', 'superadmin'])
    groupPlayerIds = (data ?? []).map((p: { id: string }) => p.id)
  } else if (group && partido_id && !partidoDelClub) {
    return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })
  } else if (group === 'confirmados' && partido_id) {
    const { data } = await admin.from('inscripciones').select('player_id').eq('partido_id', partido_id).eq('estado', 'confirmado')
    groupPlayerIds = (data ?? []).map((i: { player_id: string }) => i.player_id)
  } else if (group === 'espera' && partido_id) {
    const { data } = await admin.from('inscripciones').select('player_id').eq('partido_id', partido_id).eq('estado', 'espera')
    groupPlayerIds = (data ?? []).map((i: { player_id: string }) => i.player_id)
  } else if (group === 'todos_partido' && partido_id) {
    const { data } = await admin.from('inscripciones').select('player_id').eq('partido_id', partido_id).in('estado', ['confirmado', 'espera'])
    groupPlayerIds = (data ?? []).map((i: { player_id: string }) => i.player_id)
  }

  // Club filter as the backstop: whatever target was resolved above, a
  // subscription outside the caller's club can never be reached from here.
  let query = admin.from('push_subscriptions').select('endpoint, p256dh, auth, player_id').eq('club_id', clubId)
  if (groupPlayerIds !== null) {
    if (groupPlayerIds.length === 0) return NextResponse.json({ error: 'No hay jugadores en este grupo.' }, { status: 404 })
    query = (query as typeof query).in('player_id', groupPlayerIds)
  } else if (player_id) {
    query = (query as typeof query).eq('player_id', player_id)
  }
  const { data: subs } = await query

  if (!subs || subs.length === 0) {
    return NextResponse.json({ error: 'No hay suscripciones activas. El jugador debe activar notificaciones primero.' }, { status: 404 })
  }

  let enviados = 0
  const errores: string[] = []

  for (const sub of subs) {
    try {
      await sendPush(sub, { title: title || clubNombre, body: body || 'Notificación de prueba ⚽', url: '/' })
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

  const { data: adminProf } = await admin.from('profiles').select('username').eq('id', user.id).single()
  await logActivity({
    user_id: user.id,
    username: (adminProf as { username?: string } | null)?.username ?? null,
    accion: 'push_manual',
    detalles: {
      grupo: group ?? (player_id ? 'individual' : 'todos'),
      partido_id: partido_id ?? null,
      player_id: player_id ?? null,
      titulo: title,
      enviados,
      errores: errores.length,
    },
  })

  return NextResponse.json({
    ok: true,
    enviados,
    errores,
    mensaje: enviados > 0
      ? `Enviado a ${enviados} dispositivo(s).`
      : `No se pudo enviar. ${errores[0] ?? 'Error desconocido.'}`,
  }, { status: enviados > 0 || errores.length === 0 ? 200 : 400 })
}

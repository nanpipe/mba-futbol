import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush, isDeadPushError } from '@/lib/push'
import { calcularVentanaPartido } from '@/lib/partidos'
import { sendCuposEmail } from '@/lib/email'

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return false
  return true
}

// GET /api/cron/cupos — runs daily at noon Colombia time (17:00 UTC)
// If a match has an open inscription window with available spots,
// notify all users who are NOT yet on the list.
export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const now = new Date()
  const hoy = now.toISOString().split('T')[0]
  let totalEnviados = 0

  const { data: partidos } = await admin
    .from('partidos')
    .select('id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, club_id, cupos_total')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .limit(5)

  for (const partido of partidos ?? []) {
    const { abierta } = calcularVentanaPartido(partido)
    if (!abierta) continue

    // Count confirmed spots taken
    const { count: confirmados } = await admin
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('partido_id', partido.id)
      .eq('estado', 'confirmado')

    const cuposLibres = ((partido as { cupos_total?: number }).cupos_total ?? 14) - (confirmados ?? 0)
    if (cuposLibres <= 0) continue

    // Get IDs of players already on the list (confirmed + waitlist)
    const { data: inscritos } = await admin
      .from('inscripciones')
      .select('player_id')
      .eq('partido_id', partido.id)

    const inscritosIds = (inscritos ?? []).map((i: { player_id: string }) => i.player_id)

    // Get push subscriptions for players NOT on the list
    // Use parameterized .not().in() to avoid string concatenation
    const subsQuery = admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, player_id')

    const { data: subs } = inscritosIds.length > 0
      ? await subsQuery.not('player_id', 'in', `(${inscritosIds.join(',')})`)
      : await subsQuery

    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, {
          title: '⚽ Cupos disponibles',
          body: `Quedan ${cuposLibres} cupo${cuposLibres !== 1 ? 's' : ''} para el partido del ${partido.dia_semana}. ¡Anótate antes de que se llene!`,
          url: '/',
        })
        totalEnviados++
      } catch (err: unknown) {
        if (isDeadPushError(err)) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        } else {
          console.error('[cron/cupos] sendPush failed:', err)
        }
      }
    }

    // Send emails to approved, non-banned club players not on the list
    const clubId = (partido as { club_id?: string }).club_id
    if (clubId) {
      const emailProfilesQuery = admin
        .from('profiles')
        .select('id, email, username')
        .eq('club_id', clubId)
        .eq('aprobado', true)
        .eq('baneado', false)
        .neq('role', 'admin')

      const { data: eligibleProfiles } = inscritosIds.length > 0
        ? await emailProfilesQuery.not('id', 'in', `(${inscritosIds.join(',')})`)
        : await emailProfilesQuery

      for (const profile of eligibleProfiles ?? []) {
        try {
          await sendCuposEmail({
            email: (profile as { email: string }).email,
            username: (profile as { username: string }).username,
            diaSemana: partido.dia_semana,
            cuposLibres,
          })
        } catch (err) {
          console.error('[cron/cupos] sendCuposEmail failed:', err)
        }
      }
    }
  }

  console.log('[cron/cupos]', new Date().toISOString(), { enviados: totalEnviados })
  return NextResponse.json({ ok: true, enviados: totalEnviados })
}

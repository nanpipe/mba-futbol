import type { createAdminClient } from '@/lib/supabase/admin'
import { sendPush, isDeadPushError } from '@/lib/push'
import { sendInvitadoConfirmadoEmail, sendInvitadoEntraEmail } from '@/lib/email'

type Admin = ReturnType<typeof createAdminClient>

/** "viernes 3 de agosto" — shared by the push body and both emails. */
export function fechaPartidoStr(p: { fecha?: string; dia_semana?: string } | null): string {
  if (!p?.fecha) return 'el partido'
  const dia = new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })
  return `${p.dia_semana ?? ''} ${dia}`.trim()
}

/**
 * Tell everyone a guest got a spot: push + email to the player who invited them,
 * and — when the player supplied one — an email to the guest themselves.
 *
 * Guarded by invitados.notif_confirmado_sent so the every-minute cron can't
 * re-send. Best-effort throughout: a failed notification must never undo or
 * block the confirmation itself.
 */
export async function notificarInvitadoConfirmado(
  admin: Admin,
  invitado_id: string
): Promise<{ notificado: boolean }> {
  const { data: inv } = await admin
    .from('invitados')
    .select('id, nombre, email, player_id, partido_id, notif_confirmado_sent, partidos(fecha, dia_semana, hora, lugar, club_id)')
    .eq('id', invitado_id)
    .single()

  if (!inv || inv.notif_confirmado_sent) return { notificado: false }

  // Claim it up front — the cron ticks every minute, and a slow send would
  // otherwise let the next tick fire a duplicate.
  await admin.from('invitados').update({ notif_confirmado_sent: true }).eq('id', invitado_id)

  const partido = inv.partidos as unknown as
    { fecha: string; dia_semana: string; hora: string | null; lugar: string | null; club_id: string } | null
  const fechaStr = fechaPartidoStr(partido)
  const hora = partido?.hora?.substring(0, 5) ?? null

  let clubNombre = 'MBA Fútbol Club'
  if (partido?.club_id) {
    const { data: club } = await admin.from('clubs').select('nombre').eq('id', partido.club_id).single()
    clubNombre = (club as { nombre?: string } | null)?.nombre ?? clubNombre
  }

  const { data: invitador } = await admin
    .from('profiles').select('email, username').eq('id', inv.player_id).single()
  const invitadorNombre = (invitador as { username?: string } | null)?.username ?? 'Un jugador'

  // ── Player who invited them: push ──
  const { data: subs } = await admin
    .from('push_subscriptions').select('endpoint, p256dh, auth').eq('player_id', inv.player_id)
  for (const sub of subs ?? []) {
    try {
      await sendPush(sub, {
        title: '¡Tu invitado entró al partido!',
        body: `${inv.nombre} fue confirmado para ${fechaStr}. ⚽`,
        url: '/',
      })
    } catch (err: unknown) {
      if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      else console.error('[invitados] sendPush failed:', err)
    }
  }

  // ── Player who invited them: email ──
  const invitadorEmail = (invitador as { email?: string } | null)?.email
  if (invitadorEmail) {
    try {
      await sendInvitadoConfirmadoEmail({
        email: invitadorEmail,
        username: invitadorNombre,
        nombreInvitado: inv.nombre,
        fechaStr,
        clubNombre,
      })
    } catch (err) { console.error('[invitados] sendInvitadoConfirmadoEmail failed:', err) }
  }

  // ── The guest themselves, if we have an address ──
  if (inv.email) {
    try {
      await sendInvitadoEntraEmail({
        email: inv.email,
        nombreInvitado: inv.nombre,
        invitadoPor: invitadorNombre,
        fechaStr,
        hora,
        lugar: partido?.lugar ?? null,
        clubNombre,
      })
    } catch (err) { console.error('[invitados] sendInvitadoEntraEmail failed:', err) }
  }

  return { notificado: true }
}

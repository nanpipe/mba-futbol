import type { createAdminClient } from '@/lib/supabase/admin'
import { channelsFor } from '@/lib/notifications'
import { sendPush, isDeadPushError } from '@/lib/push'
import { sendAdminAlertEmail } from '@/lib/email'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Notify a club's admins of an event IMMEDIATELY, honoring the club's per-event
 * channel settings (email / push). Best-effort: never throws, parallel sends.
 * Replaces the old digest batching — push is fine instantly; email defaults off.
 */
export async function notifyAdmins(
  admin: AdminClient,
  clubId: string,
  eventKey: string,
  titulo: string,
  mensaje: string
): Promise<void> {
  try {
    const { data: sRows } = await admin.from('app_settings').select('key, value').eq('club_id', clubId)
    const settings: Record<string, unknown> = {}
    for (const r of (sRows ?? []) as { key: string; value: unknown }[]) settings[r.key] = r.value
    const ch = channelsFor(settings, eventKey)
    if (!ch.email && !ch.push) return

    const { data: admins } = await admin
      .from('profiles').select('id, email').eq('club_id', clubId).in('role', ['admin', 'superadmin'])
    const adminIds = (admins ?? []).map((a: { id: string }) => a.id)
    if (!adminIds.length) return

    if (ch.email) {
      await Promise.allSettled(
        (admins ?? [])
          .filter((a: { email?: string }) => a.email)
          .map((a: { email?: string }) => sendAdminAlertEmail({ email: a.email!, titulo, mensaje })
            .catch(err => console.error('[notifyAdmins] email failed:', err)))
      )
    }

    if (ch.push) {
      const { data: subs } = await admin
        .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', adminIds)
      await Promise.allSettled(
        (subs ?? []).map(sub =>
          sendPush(sub, { title: titulo, body: mensaje, url: '/admin' })
            .catch(async (err: unknown) => {
              if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
              else console.error('[notifyAdmins] push failed:', err)
            })
        )
      )
    }
  } catch (err) {
    console.error('[notifyAdmins] failed:', err)
  }
}

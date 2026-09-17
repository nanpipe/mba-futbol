import type { createAdminClient } from '@/lib/supabase/admin'
import { channelsFor } from '@/lib/notifications'
import { sendPush, isDeadPushError } from '@/lib/push'
import { sendBadgeRemovidoEmail } from '@/lib/email'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Avisarle a un jugador que le quitaron un reconocimiento.
 *
 * Vive aparte de reconocimientos.ts a propósito: ese módulo lo importa el panel
 * de admin (cliente) por su config, y arrastrar resend/web-push hasta el bundle
 * del navegador sería meter credenciales de servidor donde no van.
 *
 * Best-effort, igual que notifyAdmins: nunca lanza. Que falle un push no puede
 * tumbar la acción del admin, que ya se ejecutó.
 */
export async function avisarBadgeRemovido(
  admin: AdminClient,
  opts: {
    clubId: string
    playerId: string
    badgeNombre: string
    badgeEmoji: string
    motivo?: string | null
    clubNombre?: string
  }
): Promise<{ push_enviados: number; email_enviado: boolean }> {
  const out = { push_enviados: 0, email_enviado: false }
  try {
    const { data: sRows } = await admin
      .from('app_settings').select('key, value').eq('club_id', opts.clubId)
    const settings: Record<string, unknown> = {}
    for (const r of (sRows ?? []) as { key: string; value: unknown }[]) settings[r.key] = r.value
    const ch = channelsFor(settings, 'badge_removido')
    if (!ch.email && !ch.push) return out

    const { data: player } = await admin
      .from('profiles').select('email, username').eq('id', opts.playerId).maybeSingle()
    if (!player) return out
    const p = player as { email?: string | null; username?: string | null }

    const titulo = 'Se retiró un reconocimiento'
    const cuerpo = opts.motivo
      ? `${opts.badgeEmoji} ${opts.badgeNombre} — ${opts.motivo}`
      : `${opts.badgeEmoji} ${opts.badgeNombre} ya no aparece en tu perfil.`

    if (ch.push) {
      const { data: subs } = await admin
        .from('push_subscriptions').select('endpoint, p256dh, auth').eq('player_id', opts.playerId)
      const results = await Promise.allSettled(
        (subs ?? []).map(sub =>
          sendPush(sub, { title: titulo, body: cuerpo, url: '/perfil' })
            .catch(async (err: unknown) => {
              if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
              else console.error('[notifyBadge] push failed:', err)
              throw err
            })
        )
      )
      out.push_enviados = results.filter(r => r.status === 'fulfilled').length
    }

    if (ch.email && p.email) {
      const r = await sendBadgeRemovidoEmail({
        email: p.email,
        username: p.username ?? 'jugador',
        badgeNombre: opts.badgeNombre,
        badgeEmoji: opts.badgeEmoji,
        motivo: opts.motivo,
        clubNombre: opts.clubNombre,
      }).catch(err => { console.error('[notifyBadge] email failed:', err); return { ok: false } })
      out.email_enviado = r.ok
    }
  } catch (err) {
    console.error('[notifyBadge] failed:', err)
  }
  return out
}

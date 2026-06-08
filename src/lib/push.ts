import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@futbol.niebla.co',
  process.env.NEXT_PUBLIC_PUSHER_APP_KEY!,
  process.env.PUSHER_APP_SECRET!
)

export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url?: string }
) {
  await webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload)
  )
}

// Push-service status codes that mean the subscription is permanently dead and
// should be pruned: 400 (bad/VAPID mismatch), 403 (VAPID rejected), 404 (gone),
// 410 (gone). Retrying these never succeeds.
const DEAD_PUSH_CODES = new Set([400, 403, 404, 410])

export function isDeadPushError(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode
  return code !== undefined && DEAD_PUSH_CODES.has(code)
}

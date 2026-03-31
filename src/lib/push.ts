import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:admin@futbol.niebla.co',
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

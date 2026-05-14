// ── Cache config ─────────────────────────────────────────────────────────────
// Bump CACHE_VER manually if you need to nuke all cached pages (rare).
const CACHE_VER = 'v1'
const CACHE_SHELL = `mba-shell-${CACHE_VER}`
const CACHE_STATIC = `mba-static-${CACHE_VER}`

// ── Install: skip waiting immediately so new SW takes over fast ───────────────
self.addEventListener('install', () => self.skipWaiting())

// ── Activate: claim clients + delete old caches ───────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_SHELL && k !== CACHE_STATIC)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Only handle GET on same origin or next static CDN
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin && !url.pathname.startsWith('/_next/')) return

  // API calls — always network, never cache
  if (url.pathname.startsWith('/api/')) return

  // Next.js static chunks: content-hashed → safe to cache forever (cache-first)
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.open(CACHE_STATIC).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached
          return fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone())
            return res
          })
        })
      )
    )
    return
  }

  // HTML navigation: stale-while-revalidate
  // → serve cached instantly if available, fetch fresh in background
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      caches.open(CACHE_SHELL).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request)
            .then(res => {
              if (res.ok) cache.put(request, res.clone())
              return res
            })
            .catch(() => cached) // if network fails, cached is already returned below

          // Serve cached immediately; fetch runs in background to refresh
          return cached ?? fetchPromise
        })
      )
    )
    return
  }
})

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'MBA FC', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data.url)
    })
  )
})

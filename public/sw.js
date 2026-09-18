// ── Cache config ─────────────────────────────────────────────────────────────
// Bump CACHE_VER manually if you need to nuke all cached pages (rare).
// v2 (2026-09-18): el shell y los chunks guardados por v1 pueden ser de una
// versión anterior de la app — ver la nota de la navegación HTML abajo. Subir la
// versión los borra en el activate, así que todo el mundo arranca limpio en vez
// de quedarse con lo que tuviera pegado.
const CACHE_VER = 'v2'
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

  // HTML navigation: network-first, con el caché como red de seguridad.
  //
  // Antes era stale-while-revalidate y eso escondía cada deploy una vuelta
  // entera. El HTML referencia los chunks de Next por su hash, y los chunks se
  // cachean para siempre (cache-first, arriba). Al servir el HTML viejo de
  // caché, ese HTML pedía los chunks VIEJOS — que seguían cacheados — así que
  // la app entera se quedaba en la versión anterior. El fetch de fondo
  // refrescaba el HTML, pero para la apertura SIGUIENTE: había que abrir dos
  // veces para ver un cambio, y quien abría una sola vez juraba que no estaba.
  //
  // Peor todavía: si el deploy viejo ya no sirve esos chunks y tampoco están en
  // caché, la pantalla queda en blanco.
  //
  // Con red primero, un deploy se ve en la primera apertura. Sin conexión sigue
  // funcionando: cae al HTML guardado.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const copia = res.clone()
            caches.open(CACHE_SHELL).then(cache => cache.put(request, copia))
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(request, { cacheName: CACHE_SHELL })
          if (cached) return cached
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Sin conexión</title>' +
            '<body style="background:#0a0a0a;color:#f0f0f0;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">' +
            '<div style="text-align:center"><div style="font-size:40px">⚽</div><p>Sin conexión</p></div>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        })
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

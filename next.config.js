/** @type {import('next').NextConfig} */

const { version } = require('./package.json')
const isDev = process.env.NODE_ENV === 'development'

// Content Security Policy
// unsafe-inline required by Next.js App Router (inline hydration scripts/styles)
// unsafe-eval required in dev only
const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' blob:${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Supabase storage for avatars + self + data URIs + blobs
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' https://fonts.gstatic.com",
  // Supabase (realtime WS + REST + auth) + imgly BG removal CDN
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://staticimgly.com${isDev ? ' http://localhost:*' : ''}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",   // prevents clickjacking at CSP level
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
]

const securityHeaders = [
  // Prevent clickjacking (legacy header + CSP frame-ancestors above)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Prevent MIME sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrer policy — don't leak URL in cross-origin requests
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features we don't use
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  // Force HTTPS for 2 years (only in prod — dev uses http)
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
  // Isolate browsing context — prevents cross-origin window attacks
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Prevent cross-origin resource leakage
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
  // CSP
  { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
  // Disable DNS prefetch
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

// Lo que se muestra en el pie. `version` de package.json llevaba en 0.1.0
// desde siempre porque nadie la sube a mano, así que no decía nada sobre qué
// está desplegado. El hash del commit lo pone Vercel en cada build y no hay
// que acordarse de nada. En local no existe, y ahí sí sirve la versión.
const commit = process.env.VERCEL_GIT_COMMIT_SHA
const APP_VERSION = commit ? commit.slice(0, 7) : `${version}-dev`

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig

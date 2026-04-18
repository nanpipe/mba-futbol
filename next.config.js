/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development'

// Content Security Policy
// unsafe-inline required by Next.js App Router (inline hydration scripts/styles)
// unsafe-eval required in dev only
const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Supabase (realtime WS + REST + auth)
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? ' http://localhost:*' : ''}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
]

const securityHeaders = [
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Prevent MIME sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrer policy — don't leak URL in cross-origin requests
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features we don't use
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  // Force HTTPS for 2 years (only in prod — dev uses http)
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
  // CSP
  { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
  // Disable DNS prefetch
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig = {
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

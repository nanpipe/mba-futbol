import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const h = await headers()
  const nombre = h.get('x-club-nombre') ?? 'MBA FC'

  return {
    name: `${nombre} — Fútbol Club`,
    short_name: nombre,
    description: 'Registro de partidos y evaluaciones',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#0a0a0a',
    background_color: '#0a0a0a',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }
}

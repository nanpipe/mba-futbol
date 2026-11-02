import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getTemaClub } from '@/lib/temaServidor'
import { derivarTokens } from '@/lib/tema'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const h = await headers()
  const nombre = h.get('x-club-nombre') ?? 'MBA FC'
  // Android solo relee esto al reinstalar la app; el editor de colores lo avisa.
  const tema = await getTemaClub(h.get('x-club-id'))
  const fondo = tema ? derivarTokens(tema)['--bg'] : '#0a0a0a'

  return {
    name: `${nombre} — Fútbol Club`,
    short_name: nombre,
    description: 'Registro de partidos y evaluaciones',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: fondo,
    background_color: fondo,
    // Chrome only treats the app as installable if there's an icon with purpose
    // "any" — with maskable-only icons beforeinstallprompt never fires, so
    // Android never got the install button. Declare both purposes.
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

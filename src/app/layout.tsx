import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration'
import { PullToRefresh } from '@/components/PullToRefresh'
import { getTemaClub } from '@/lib/temaServidor'
import { cssDelTema, derivarTokens } from '@/lib/tema'

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  const nombre = h.get('x-club-nombre') ?? 'Fútbol Club'
  return {
    title: nombre,
    description: `Inscripciones y partidos de ${nombre}`,
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const clubNombre = h.get('x-club-nombre') ?? 'Fútbol Club'
  // Colores del club. Viene en el HTML del servidor, así que el primer pintado
  // ya sale con ellos: sin parpadeo, incluso sin JS. Ver lib/tema.ts.
  const tema = await getTemaClub(h.get('x-club-id'))
  const themeColor = tema ? derivarTokens(tema)['--bg'] : '#0a0a0a'

  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content={themeColor} />
        {tema && <style id="tema-club" dangerouslySetInnerHTML={{ __html: cssDelTema(tema) }} />}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={clubNombre} />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" href="/icon-192.png" type="image/png" />
        {/*
          Chrome fires beforeinstallprompt during page load — usually before React
          hydrates, so a listener added in an effect misses it entirely and the
          install button never appears. Stash the event here, before hydration;
          useInstallState() picks it up from window.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__mbafcInstallPrompt=e;window.dispatchEvent(new Event('mbafc:installprompt'))});`,
          }}
        />
      </head>
      <body>
        <ServiceWorkerRegistration />
        <PullToRefresh>{children}</PullToRefresh>
      </body>
    </html>
  )
}

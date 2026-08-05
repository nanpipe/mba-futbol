'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Install push ─────────────────────────────────────────────────────────────
// A PWA install can't be forced: iOS has no install API at all (Share → Add to
// Home Screen is manual), and in-app browsers (WhatsApp, Instagram) can't
// install one at any price. So this leans on friction, never a hard block —
// every screen here has a way out, or users who open the link from a WhatsApp
// group would be locked out of signing up with no path forward.

const SESSION_KEY = 'mbafc_install_interstitial_seen'
const ESCAPE_SECONDS = 5
const NAG_SECONDS = 10

export interface InstallState {
  /** Already installed and running from the home screen. */
  isStandalone: boolean
  isIos: boolean
  /** In-app browser (WhatsApp/Instagram/etc) — installing is impossible here. */
  isInApp: boolean
  /** Android/Chrome gave us a real install prompt we can fire. */
  canPrompt: boolean
  promptInstall: () => void
}

const IN_APP_UA = /FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp|Snapchat|MicroMessenger/i

export function useInstallState(): InstallState {
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt: () => void }) | null>(null)
  const [isIos, setIsIos] = useState(false)
  const [isInApp, setIsInApp] = useState(false)
  const [isStandalone, setIsStandalone] = useState(true) // assume installed until proven otherwise (avoids a flash)

  useEffect(() => {
    const ua = navigator.userAgent
    setIsIos(/iphone|ipad|ipod/i.test(ua))
    setIsInApp(IN_APP_UA.test(ua))

    const mq = window.matchMedia('(display-mode: standalone)')
    const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true
    const read = () => setIsStandalone(mq.matches || iosStandalone)
    read()
    mq.addEventListener('change', read)

    // The event usually fires before hydration, so layout.tsx stashes it on
    // window. Read the stash first, then keep listening for a later one.
    type W = Window & { __mbafcInstallPrompt?: Event & { prompt: () => void } }
    const stashed = (window as W).__mbafcInstallPrompt
    if (stashed) setInstallPrompt(stashed)
    const fromStash = () => {
      const e = (window as W).__mbafcInstallPrompt
      if (e) setInstallPrompt(e)
    }
    window.addEventListener('mbafc:installprompt', fromStash)

    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as Event & { prompt: () => void }) }
    window.addEventListener('beforeinstallprompt', handler)
    // Installed mid-session — drop the nagging immediately.
    const installed = () => { setIsStandalone(true); setInstallPrompt(null) }
    window.addEventListener('appinstalled', installed)

    return () => {
      mq.removeEventListener('change', read)
      window.removeEventListener('mbafc:installprompt', fromStash)
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  const promptInstall = useCallback(() => {
    if (!installPrompt) return
    installPrompt.prompt()
    // A prompt event can only be used once — drop it and the stash.
    delete (window as Window & { __mbafcInstallPrompt?: unknown }).__mbafcInstallPrompt
    setInstallPrompt(null)
  }, [installPrompt])

  return { isStandalone, isIos, isInApp, canPrompt: !!installPrompt, promptInstall }
}

/** Counts down from `from`, returns seconds left (0 when done). */
function useCountdown(from: number, active: boolean): number {
  const [left, setLeft] = useState(from)
  useEffect(() => {
    if (!active) { setLeft(from); return }
    setLeft(from)
    const id = setInterval(() => setLeft(n => (n <= 1 ? (clearInterval(id), 0) : n - 1)), 1000)
    return () => clearInterval(id)
  }, [active, from])
  return left
}

const BENEFITS = [
  { icon: '🔔', text: 'Aviso al instante cuando abren los cupos' },
  { icon: '⚡', text: 'Entras de una, sin buscar el link' },
  { icon: '📱', text: 'Pantalla completa, sin barra del navegador' },
]

function Benefits({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12, width: '100%' }}>
      {BENEFITS.map(b => (
        <div key={b.text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: compact ? 17 : 20, flexShrink: 0 }}>{b.icon}</span>
          <span className="mono" style={{ fontSize: compact ? 11 : 12, color: 'var(--text-muted)', lineHeight: 1.5, textAlign: 'left' }}>
            {b.text}
          </span>
        </div>
      ))}
    </div>
  )
}

/** iOS share glyph, drawn inline — the SF Symbols character renders as tofu off Apple. */
function ShareIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: '-0.18em', margin: '0 2px' }}
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}

/** Android overflow-menu glyph (⋮). */
function MenuIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
      style={{ display: 'inline-block', verticalAlign: '-0.18em', margin: '0 2px' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  )
}

/** How to install, tailored to the browser the user is actually in. */
function HowTo({ state, big }: { state: InstallState; big: boolean }) {
  const { isIos, isInApp, canPrompt, promptInstall } = state

  if (isInApp) {
    return (
      <div className="mono" style={{
        fontSize: 12, color: 'var(--amber)', lineHeight: 1.7, textAlign: 'center',
        background: '#2d2508', border: '1px solid #92400e', borderRadius: 6, padding: '14px 16px',
      }}>
        Estás en el navegador de otra app y aquí no se puede instalar.<br />
        Toca <strong>···</strong> y elige <strong>&quot;Abrir en {isIos ? 'Safari' : 'Chrome'}&quot;</strong>.
      </div>
    )
  }

  if (canPrompt) {
    return (
      <button
        onClick={promptInstall}
        className="btn btn-primary"
        style={{ fontSize: big ? 15 : 13, padding: big ? '16px 32px' : '12px 24px', width: '100%' }}
      >
        📲 Instalar ahora
      </button>
    )
  }

  // No prompt available — manual steps, worded for the actual platform.
  return (
    <div className="mono" style={{
      fontSize: 12, color: 'var(--green)', lineHeight: 1.8, textAlign: 'center',
      background: '#0f2d1a', border: '1px solid #16a34a', borderRadius: 6, padding: '14px 16px',
    }}>
      {isIos ? (
        <>
          <div style={{ marginBottom: 6 }}>
            1. Toca <strong>Compartir</strong><ShareIcon /> abajo
          </div>
          <div>2. Elige <strong>Agregar a pantalla de inicio</strong></div>
          <div style={{ fontSize: 22, marginTop: 8, animation: 'mbafcBounce 1.2s ease-in-out infinite' }}>↓</div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 6 }}>
            1. Toca el menú<MenuIcon /> arriba a la derecha
          </div>
          <div>2. Elige <strong>Instalar app</strong> o <strong>Agregar a pantalla de inicio</strong></div>
          <div style={{ fontSize: 22, marginTop: 8, animation: 'mbafcBounce 1.2s ease-in-out infinite' }}>↑</div>
        </>
      )}
    </div>
  )
}

// ── Full-screen interstitial, once per session ───────────────────────────────
export function InstallInterstitial({ state }: { state: InstallState }) {
  const [dismissed, setDismissed] = useState(true) // stays hidden until we've checked the session
  const show = !state.isStandalone && !dismissed
  const left = useCountdown(ESCAPE_SECONDS, show)

  useEffect(() => {
    if (state.isStandalone) return
    setDismissed(sessionStorage.getItem(SESSION_KEY) === '1')
  }, [state.isStandalone])

  // Lock the page behind the overlay while it's up.
  useEffect(() => {
    if (!show) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [show])

  if (!show) return null

  const cerrar = () => {
    sessionStorage.setItem(SESSION_KEY, '1')
    setDismissed(true)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(4, 10, 6, 0.97)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, overflowY: 'auto',
    }}>
      <style>{`@keyframes mbafcBounce { 0%,100% { transform: translateY(0) } 50% { transform: translateY(7px) } }`}</style>

      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, textAlign: 'center' }}>
        <div style={{ fontSize: 52, lineHeight: 1 }}>📲</div>

        <div>
          <div className="display" style={{ fontSize: 28, letterSpacing: '0.04em', lineHeight: 1.15 }}>
            INSTALA LA APP
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', marginTop: 8, lineHeight: 1.6 }}>
            Sin la app te vas a perder los cupos
          </div>
        </div>

        <Benefits />

        <div style={{ width: '100%' }}>
          <HowTo state={state} big />
        </div>

        <button
          onClick={cerrar}
          disabled={left > 0}
          className="mono"
          style={{
            background: 'none', border: 'none', padding: '6px 10px',
            fontSize: 11, color: 'var(--text-dim)',
            cursor: left > 0 ? 'default' : 'pointer',
            opacity: left > 0 ? 0.4 : 0.75,
            textDecoration: left > 0 ? 'none' : 'underline',
          }}
        >
          {left > 0 ? `Continuar en el navegador (${left})` : 'Continuar en el navegador'}
        </button>
      </div>
    </div>
  )
}

// ── Pre-signup nag: 10s wait, then let them through ──────────────────────────
export function InstallNagModal({
  open,
  state,
  onContinue,
  onCancel,
}: {
  open: boolean
  state: InstallState
  onContinue: () => void
  onCancel: () => void
}) {
  const left = useCountdown(NAG_SECONDS, open)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(4, 10, 6, 0.92)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, overflowY: 'auto',
      }}
    >
      <style>{`@keyframes mbafcBounce { 0%,100% { transform: translateY(0) } 50% { transform: translateY(7px) } }`}</style>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 340,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '26px 24px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }}>🔔</div>

        <div>
          <div className="display" style={{ fontSize: 20, letterSpacing: '0.04em', lineHeight: 1.2 }}>
            ANTES DE INSCRIBIRTE
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            Instala la app y no te quedas por fuera del próximo partido
          </div>
        </div>

        <Benefits compact />

        <div style={{ width: '100%' }}>
          <HowTo state={state} big={false} />
        </div>

        <button
          onClick={onContinue}
          disabled={left > 0}
          className="btn btn-ghost"
          style={{
            fontSize: 12, padding: '10px 20px', width: '100%',
            opacity: left > 0 ? 0.45 : 1,
            cursor: left > 0 ? 'default' : 'pointer',
          }}
        >
          {left > 0 ? `Espera ${left}s...` : 'Continuar e inscribirme →'}
        </button>
      </div>
    </div>
  )
}

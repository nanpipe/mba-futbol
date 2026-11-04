'use client'

import { useState, useRef, useCallback } from 'react'

const PULL_THRESHOLD = 72

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullY, setPullY] = useState(0)
  const [pulling, setPulling] = useState(false)
  const touchStartY = useRef(0)
  // Un gesto que empieza dentro de un modal no es "bajar para actualizar":
  // arrastrar la foto hacia abajo en el recorte recargaba la página y se
  // perdía todo. Los modales van por portal, pero los eventos de React igual
  // suben hasta acá, así que hay que mirar el destino.
  const ignorar = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    ignorar.current = (e.target as Element | null)?.closest?.('.modal-overlay') != null
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (ignorar.current) return
    if (window.scrollY > 0) return
    const delta = e.touches[0].clientY - touchStartY.current
    if (delta > 0) {
      setPullY(Math.min(delta, PULL_THRESHOLD + 24))
      setPulling(true)
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!ignorar.current && pullY >= PULL_THRESHOLD) window.location.reload()
    ignorar.current = false
    setPullY(0)
    setPulling(false)
  }, [pullY])

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ minHeight: '100vh' }}
    >
      {pulling && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: Math.min(pullY, PULL_THRESHOLD + 24),
            background: 'var(--bg)',
            borderBottom: pullY >= PULL_THRESHOLD ? '1px solid var(--primary)' : '1px solid var(--border)',
            transition: 'border-color 0.15s',
            overflow: 'hidden',
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 12,
              color: pullY >= PULL_THRESHOLD ? 'var(--primary)' : 'var(--text-muted)',
              letterSpacing: '0.1em',
              opacity: Math.min(pullY / PULL_THRESHOLD, 1),
              transition: 'color 0.15s',
            }}
          >
            {pullY >= PULL_THRESHOLD ? '↻ SOLTAR PARA ACTUALIZAR' : '↓ BAJAR PARA ACTUALIZAR'}
          </span>
        </div>
      )}
      {children}
    </div>
  )
}

'use client'

/** Fullscreen modal backdrop. Standard z-index 200; content centered. */
export function ModalOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200 }}>
      {children}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Fullscreen modal backdrop. Standard z-index 200; content centered.
 *
 * Se pinta en <body> con un portal, no donde se declara. Un modal declarado
 * dentro de una tarjeta queda atrapado en la capa de esa tarjeta (cualquier
 * ancestro con opacity animada, transform o filter crea una): su z-index solo
 * compite adentro, y la tarjeta siguiente se pinta encima. Así pasó con el
 * recorte de la foto del partido en el inicio: el contador del próximo partido
 * le quedaba encima y no se podía tocar.
 */
export function ModalOverlay({ children }: { children: React.ReactNode }) {
  const [montado, setMontado] = useState(false)
  useEffect(() => { setMontado(true) }, [])
  if (!montado) return null
  return createPortal(
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200 }}>
      {children}
    </div>,
    document.body,
  )
}

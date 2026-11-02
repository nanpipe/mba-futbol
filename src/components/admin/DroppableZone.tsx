'use client'

import { useDroppable } from '@dnd-kit/core'

interface Props {
  equipo: 'A' | 'B' | 'C'
  children: React.ReactNode
  isConfirmado: boolean
}

const COLORS: Record<'A' | 'B' | 'C', string> = {
  A: 'var(--primary)',
  B: 'var(--amber)',
  C: 'var(--mini-line)',
}

const BG_OVER: Record<'A' | 'B' | 'C', string> = {
  A: '#0a1f0f',
  B: 'var(--warn-soft)',
  C: '#1a0f2e',
}

export function DroppableZone({ equipo, children, isConfirmado }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `equipo-${equipo}`, disabled: isConfirmado })
  const color = COLORS[equipo]
  const bgOver = BG_OVER[equipo]

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 160,
        background: isOver ? bgOver : 'transparent',
        border: `2px dashed ${isOver ? color : 'var(--border)'}`,
        borderRadius: 6,
        padding: 8,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {children}
    </div>
  )
}

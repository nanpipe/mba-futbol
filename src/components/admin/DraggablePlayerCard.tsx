'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { posicionEmoji } from '@/lib/teamBalancer'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import type { JugadorEquipo } from '@/types/admin'

interface Props {
  jugador: JugadorEquipo
  equipo: 'A' | 'B' | 'C'
  confirmado: boolean
}

export function DraggablePlayerCard({ jugador, equipo, confirmado }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: jugador.id,
    data: { equipo },
    disabled: confirmado,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.25 : 1,
        padding: '8px 10px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        cursor: confirmado ? 'default' : 'grab',
        touchAction: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
        transition: 'opacity 0.1s',
      }}
      {...(!confirmado ? listeners : {})}
      {...(!confirmado ? attributes : {})}
    >
      <PlayerAvatar url={jugador.avatar_url} username={jugador.username} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {jugador.username}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          {posicionEmoji(jugador.posicion)} ★{jugador.habilidad.toFixed(1)}
        </div>
      </div>
      {!confirmado && <span style={{ color: 'var(--text-dim)', fontSize: 14, flexShrink: 0 }}>⠿</span>}
    </div>
  )
}

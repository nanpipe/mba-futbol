'use client'

import { PlayerAvatar } from '@/components/PlayerAvatar'

export interface ThumbTeammate {
  id: string
  username: string
  avatar_url: string | null
}

// 44×44: el mínimo para el pulgar. Sin elegir, los tres van a opacidad plena
// (apagados parecían deshabilitados al sol); al elegir uno se apagan los otros.
function thumbStyle(active: boolean, kind: 'up' | 'neutral' | 'down', algunoElegido: boolean): React.CSSProperties {
  const color = kind === 'up' ? 'var(--green)' : kind === 'down' ? 'var(--red)' : 'var(--text-muted)'
  const bg = kind === 'up' ? '#0f2d1a' : kind === 'down' ? '#2d0a0a' : 'var(--bg-elevated)'
  return {
    fontSize: 20,
    lineHeight: 1,
    width: 44,
    height: 44,
    flexShrink: 0,
    padding: 0,
    borderRadius: 8,
    cursor: 'pointer',
    background: active ? bg : 'transparent',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    opacity: active || !algunoElegido ? 1 : 0.45,
    transition: 'all 0.15s',
  }
}

/**
 * Rate each teammate 👍 / 😐 / 👎. Clicking the active value again clears it.
 * Neutral is a real answer meaning "no opinion": it marks the teammate as rated
 * but sends nothing, so it never counts for or against them.
 * Controlled: parent holds `values` (playerId → 1 | 0 | -1).
 */
export function ThumbsRater({
  teammates,
  values,
  onSet,
}: {
  teammates: ThumbTeammate[]
  values: Record<string, 1 | 0 | -1>
  onSet: (id: string, value: 1 | 0 | -1) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {teammates.map(t => {
        const v = values[t.id]
        return (
          <div
            key={t.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px 8px 14px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}
          >
            <PlayerAvatar url={t.avatar_url} username={t.username} size={28} borderColor="rgba(255,255,255,0.1)" />
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.username}
            </span>
            <button onClick={() => onSet(t.id, 1)} aria-label={`Pulgar arriba ${t.username}`} style={thumbStyle(v === 1, 'up', v !== undefined)}>👍</button>
            <button onClick={() => onSet(t.id, 0)} aria-label={`Neutral ${t.username}`} style={thumbStyle(v === 0, 'neutral', v !== undefined)}>😐</button>
            <button onClick={() => onSet(t.id, -1)} aria-label={`Pulgar abajo ${t.username}`} style={thumbStyle(v === -1, 'down', v !== undefined)}>👎</button>
          </div>
        )
      })}
    </div>
  )
}

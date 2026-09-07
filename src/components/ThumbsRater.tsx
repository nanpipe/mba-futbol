'use client'

import { PlayerAvatar } from '@/components/PlayerAvatar'

export interface ThumbTeammate {
  id: string
  username: string
  avatar_url: string | null
}

function thumbStyle(active: boolean, kind: 'up' | 'neutral' | 'down'): React.CSSProperties {
  const color = kind === 'up' ? 'var(--green)' : kind === 'down' ? 'var(--red)' : 'var(--text-muted)'
  const bg = kind === 'up' ? '#0f2d1a' : kind === 'down' ? '#2d0a0a' : 'var(--bg-elevated)'
  return {
    fontSize: 18,
    lineHeight: 1,
    padding: '6px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? bg : 'transparent',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    opacity: active ? 1 : 0.55,
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
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}
          >
            <PlayerAvatar url={t.avatar_url} username={t.username} size={28} borderColor="rgba(255,255,255,0.1)" />
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.username}
            </span>
            <button onClick={() => onSet(t.id, 1)} aria-label={`Pulgar arriba ${t.username}`} style={thumbStyle(v === 1, 'up')}>👍</button>
            <button onClick={() => onSet(t.id, 0)} aria-label={`Neutral ${t.username}`} style={thumbStyle(v === 0, 'neutral')}>😐</button>
            <button onClick={() => onSet(t.id, -1)} aria-label={`Pulgar abajo ${t.username}`} style={thumbStyle(v === -1, 'down')}>👎</button>
          </div>
        )
      })}
    </div>
  )
}

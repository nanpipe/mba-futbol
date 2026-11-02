import type { CSSProperties } from 'react'

export function colorLabel(c: string): string {
  return c === 'blanco' ? '🤍 BLANCO' : '🖤 NEGRO'
}

// ── Status message backgrounds ────────────────────────────────
export const MSG = {
  ok:    { background: 'var(--pos-soft)', border: '1px solid var(--pos-line)', color: 'var(--pos)'  },
  error: { background: 'var(--neg-soft)', border: '1px solid var(--neg-line)', color: 'var(--red)'    },
  warn:  { background: 'var(--warn-soft)', border: '1px solid var(--warn-line)', color: 'var(--amber)'  },
} as const

// ── Shared colors ─────────────────────────────────────────────
export const C = {
  avatarBg:  'var(--primary-soft)',
  portero:   'var(--portero)',
  greenDim:  'var(--primary-line)',
  amberDim:  'var(--warn-line)',
  redBg:     'var(--neg-soft)',
  redBorder: 'var(--neg-line)',
} as const


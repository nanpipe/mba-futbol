import type { CSSProperties } from 'react'

// ── Team colors ───────────────────────────────────────────────
export const TEAM_A = {
  color: 'var(--green)' as string,
  border: '#16a34a',
  bg: '#0a1f0a',
  bgDark: '#0f2d1a',
} as const

export const TEAM_B = {
  color: 'var(--amber)' as string,
  border: '#92400e',
  bg: '#1a1500',
  bgDark: '#2d1f00',
} as const

export function teamColors(nombre: 'A' | 'B') {
  return nombre === 'A' ? TEAM_A : TEAM_B
}

export function colorLabel(c: string): string {
  return c === 'blanco' ? '🤍 BLANCO' : '🖤 NEGRO'
}

// ── Status message backgrounds ────────────────────────────────
export const MSG = {
  ok:    { background: '#0f2d1a', border: '1px solid #16a34a', color: 'var(--green)'  },
  error: { background: '#2d0a0a', border: '1px solid #7f1d1d', color: 'var(--red)'    },
  warn:  { background: '#1a1500', border: '1px solid #92400e', color: 'var(--amber)'  },
} as const

// ── Shared colors ─────────────────────────────────────────────
export const C = {
  avatarBg:  '#0f2d1a',
  portero:   '#818cf8',
  greenDim:  '#16a34a',
  amberDim:  '#92400e',
  redBg:     '#2d0a0a',
  redBorder: '#7f1d1d',
} as const


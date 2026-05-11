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
  ok:   { background: '#0f2d1a', border: '1px solid #16a34a', color: 'var(--green)'  } as CSSProperties,
  error:{ background: '#2d0a0a', border: '1px solid #7f1d1d', color: 'var(--red)'    } as CSSProperties,
  warn: { background: '#1a1500', border: '1px solid #92400e', color: 'var(--amber)'  } as CSSProperties,
}

// ── Shared colors ─────────────────────────────────────────────
export const C = {
  avatarBg:  '#0f2d1a',
  portero:   '#818cf8',
  greenDim:  '#16a34a',
  amberDim:  '#92400e',
  redBg:     '#2d0a0a',
  redBorder: '#7f1d1d',
} as const

// ── FIFA stat section colors ──────────────────────────────────
export const STAT_COLOR: Record<string, string> = {
  res: '#22d3ee',
  fis: '#f97316',
  def: '#60a5fa',
  ata: '#facc15',
  tec: '#a78bfa',
  dis: '#4ade80',
}

// ── Style helpers ─────────────────────────────────────────────
export const sx = {
  flexRow:     (gap = 8):  CSSProperties => ({ display: 'flex', alignItems: 'center', gap }),
  flexCol:     (gap = 8):  CSSProperties => ({ display: 'flex', flexDirection: 'column', gap }),
  flexBetween: (gap = 0):  CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: gap || undefined }),
  flexCenter:  ():         CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'center' }),
  screenCenter:(gap = 32): CSSProperties => ({ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap }),
  monoLabel:               { fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' } as CSSProperties,
  monoDim:                 { fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)'   } as CSSProperties,
}

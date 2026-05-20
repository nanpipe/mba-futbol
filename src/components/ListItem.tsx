'use client'

import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  style?: CSSProperties
  onClick?: () => void
  dimmed?: boolean
}

export function ListItem({ children, style, onClick, dimmed = false }: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        cursor: onClick ? 'pointer' : undefined,
        opacity: dimmed ? 0.6 : 1,
        flexWrap: 'wrap',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

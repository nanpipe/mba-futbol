'use client'

import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  padding?: number | string
  style?: CSSProperties
  onClick?: () => void
}

export function Card({ children, padding = 24, style, onClick }: Props) {
  return (
    <div
      className="card"
      onClick={onClick}
      style={{ padding, cursor: onClick ? 'pointer' : undefined, ...style }}
    >
      {children}
    </div>
  )
}

'use client'

import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  gap?: number
  marginTop?: number
  style?: CSSProperties
}

export function ButtonGroup({ children, gap = 8, marginTop, style }: Props) {
  return (
    <div style={{
      display: 'flex',
      gap,
      marginTop,
      alignItems: 'center',
      ...style,
    }}>
      {children}
    </div>
  )
}

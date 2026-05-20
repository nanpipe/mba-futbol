'use client'

import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  maxWidth?: number
}

export function FormCenterLayout({ children, maxWidth = 400 }: Props) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 20px',
    }}>
      <div style={{ width: '100%', maxWidth }}>
        {children}
      </div>
    </div>
  )
}

'use client'

import { MSG } from '@/lib/design'

interface Props {
  message: string
}

export function ErrorAlert({ message }: Props) {
  return (
    <div className="mono" style={{
      fontSize: 13,
      padding: '10px 14px',
      borderRadius: 3,
      letterSpacing: '0.05em',
      ...MSG.error,
    }}>
      {message}
    </div>
  )
}

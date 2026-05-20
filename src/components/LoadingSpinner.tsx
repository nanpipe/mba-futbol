'use client'

interface Props {
  text?: string
  padding?: number
}

export function LoadingSpinner({ text = 'Cargando...', padding = 48 }: Props) {
  return (
    <div className="mono pulsing" style={{
      fontSize: 13,
      color: 'var(--text-muted)',
      textAlign: 'center',
      padding,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>
      {text}
    </div>
  )
}

'use client'

interface Props {
  label: string
  required?: boolean
}

export function FormLabel({ label, required = false }: Props) {
  return (
    <label className="mono" style={{
      fontSize: 11,
      color: 'var(--text-muted)',
      letterSpacing: '0.1em',
      display: 'block',
      marginBottom: 8,
      textTransform: 'uppercase',
    }}>
      {label}{required && <span style={{ color: 'var(--red)' }}> *</span>}
    </label>
  )
}

'use client'

interface Props {
  title: string
  icon?: string
  count?: number | null
  color?: string
}

export function SectionHeader({ title, icon = '', count, color = 'var(--text-muted)' }: Props) {
  return (
    <div className="mono" style={{
      fontSize: 10,
      letterSpacing: '0.15em',
      color,
      marginBottom: 12,
      textTransform: 'uppercase',
    }}>
      {icon} {title}{count !== null && count !== undefined && ` (${count})`}
    </div>
  )
}

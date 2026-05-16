'use client'

interface Props {
  checked: boolean
  onChange: (value: boolean) => void
}

export function ToggleSwitch({ checked, onChange }: Props) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? 'var(--green)' : 'var(--border)',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
        }}
      />
    </button>
  )
}

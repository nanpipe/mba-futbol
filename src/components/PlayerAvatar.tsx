interface PlayerAvatarProps {
  url: string | null
  username: string
  size?: number
  borderColor?: string
}

export function PlayerAvatar({ url, username, size = 32, borderColor }: PlayerAvatarProps) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: url ? 'transparent' : '#0f2d1a',
      border: `1px solid ${borderColor ?? 'var(--border)'}`,
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {url ? (
        <img src={url} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span className="display" style={{ fontSize: size * 0.4, color: 'var(--green)', lineHeight: 1 }}>
          {username?.[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  )
}

'use client'
import { ratingTierStyle } from '@/lib/tier'

export function FifaCard({
  username,
  avatar_url,
  rating,
  size = 'md',
  clubNombre,
}: {
  username: string
  avatar_url?: string | null
  rating: number
  size?: 'sm' | 'md' | 'lg'
  clubNombre?: string
}) {
  const ts = ratingTierStyle(rating)
  const scale = size === 'sm' ? 0.65 : size === 'lg' ? 1.2 : 1
  const w = Math.round(280 * scale)
  const h = Math.round(400 * scale)
  const stars = (Math.round(rating * 10) / 10).toFixed(1)

  return (
    <div style={{
      width: w, height: h,
      background: ts.bg,
      borderRadius: Math.round(16 * scale),
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      flexShrink: 0,
    }}>
      {/* Diagonal shine overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%, rgba(0,0,0,0.1) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Rating + tier top-left */}
      <div style={{ position: 'absolute', top: Math.round(18 * scale), left: Math.round(20 * scale) }}>
        <div className="display" style={{ fontSize: Math.round(40 * scale), color: ts.text, lineHeight: 1, opacity: 0.95 }}>
          ★{stars}
        </div>
        <div className="mono" style={{ fontSize: Math.round(10 * scale), color: ts.text, opacity: 0.75, letterSpacing: '0.1em', marginTop: 6 }}>
          {ts.emoji} {ts.label}
        </div>
      </div>

      {/* Avatar area */}
      <div style={{
        position: 'absolute',
        top: Math.round(30 * scale),
        left: '50%', transform: 'translateX(-50%)',
        width: Math.round(150 * scale), height: Math.round(190 * scale),
        overflow: 'hidden',
      }}>
        {avatar_url ? (
          <img src={avatar_url} alt={username} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'bottom' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="display" style={{ fontSize: Math.round(80 * scale), color: ts.text, opacity: 0.4, lineHeight: 1 }}>
              {username?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
        )}
      </div>

      {/* Bottom section — name + tier + club */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(4px)',
        padding: `${Math.round(14 * scale)}px ${Math.round(16 * scale)}px ${Math.round(16 * scale)}px`,
      }}>
        <div className="display" style={{
          fontSize: Math.round(22 * scale),
          color: ts.text,
          textAlign: 'center',
          letterSpacing: '0.08em',
          textShadow: '0 1px 3px rgba(0,0,0,0.5)',
        }}>
          {username.toUpperCase()}
        </div>

        <div style={{ height: 1, background: `${ts.text}40`, margin: `${Math.round(8 * scale)}px 0` }} />

        <div className="mono" style={{ textAlign: 'center', fontSize: Math.round(11 * scale), color: ts.text, opacity: 0.85, letterSpacing: '0.1em' }}>
          {ts.emoji} {ts.label}
        </div>

        <div className="mono" style={{ textAlign: 'center', fontSize: Math.round(8 * scale), color: ts.text, opacity: 0.5, letterSpacing: '0.15em', marginTop: Math.round(8 * scale) }}>
          {(clubNombre ?? 'FÚTBOL CLUB').toUpperCase()}
        </div>
      </div>
    </div>
  )
}

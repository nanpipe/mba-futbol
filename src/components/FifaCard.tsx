'use client'
import { getTierStyle } from '@/lib/tier'

export interface CartaStats {
  stat_res: number; stat_fis: number; stat_def: number
  stat_ata: number; stat_tec: number; stat_dis: number
  ovr: number; tier: string; posicion_carta: string; username: string
  avatar_url?: string | null
}

export function FifaCard({ s, size = 'md' }: { s: CartaStats; size?: 'sm' | 'md' | 'lg' }) {
  const ts = getTierStyle(s.tier)
  const scale = size === 'sm' ? 0.65 : size === 'lg' ? 1.2 : 1
  const w = Math.round(280 * scale)
  const h = Math.round(400 * scale)

  const statRows = [
    [{ k: 'RES', v: s.stat_res }, { k: 'FÍS', v: s.stat_fis }],
    [{ k: 'DEF', v: s.stat_def }, { k: 'ATA', v: s.stat_ata }],
    [{ k: 'TEC', v: s.stat_tec }, { k: 'DIS', v: s.stat_dis }],
  ]

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

      {/* OVR + position top-left */}
      <div style={{ position: 'absolute', top: Math.round(18 * scale), left: Math.round(20 * scale) }}>
        <div className="display" style={{ fontSize: Math.round(42 * scale), color: ts.text, lineHeight: 1, opacity: 0.95 }}>
          {s.ovr}
        </div>
        <div className="mono" style={{ fontSize: Math.round(11 * scale), color: ts.text, opacity: 0.8, letterSpacing: '0.1em', marginTop: 2 }}>
          {s.posicion_carta?.toUpperCase() || 'JUG'}
        </div>
        <div className="mono" style={{ fontSize: Math.round(9 * scale), color: ts.text, opacity: 0.6, letterSpacing: '0.05em', marginTop: 4 }}>
          {ts.label}
        </div>
      </div>

      {/* Avatar area */}
      <div style={{
        position: 'absolute',
        top: Math.round(14 * scale),
        left: '50%', transform: 'translateX(-50%)',
        width: Math.round(120 * scale), height: Math.round(140 * scale),
        overflow: 'hidden',
      }}>
        {s.avatar_url ? (
          <img src={s.avatar_url} alt={s.username} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="display" style={{ fontSize: Math.round(64 * scale), color: ts.text, opacity: 0.4, lineHeight: 1 }}>
              {s.username?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
        )}
      </div>

      {/* Bottom section — name + stats */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(4px)',
        padding: `${Math.round(10 * scale)}px ${Math.round(16 * scale)}px ${Math.round(14 * scale)}px`,
      }}>
        {/* Name */}
        <div className="display" style={{
          fontSize: Math.round(20 * scale),
          color: ts.text,
          textAlign: 'center',
          letterSpacing: '0.08em',
          marginBottom: Math.round(8 * scale),
          textShadow: '0 1px 3px rgba(0,0,0,0.5)',
        }}>
          {s.username.toUpperCase()}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: `${ts.text}40`, margin: `${Math.round(6 * scale)}px 0` }} />

        {/* Stats grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(3 * scale) }}>
          {statRows.map((row, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: Math.round(4 * scale) }}>
              {/* Left stat */}
              <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(4 * scale), justifyContent: 'flex-end' }}>
                <span className="display" style={{ fontSize: Math.round(14 * scale), color: ts.text }}>{row[0].v}</span>
                <span className="mono" style={{ fontSize: Math.round(9 * scale), color: ts.text, opacity: 0.7, letterSpacing: '0.05em' }}>{row[0].k}</span>
              </div>
              {/* Divider */}
              <div style={{ width: 1, height: Math.round(12 * scale), background: `${ts.text}40` }} />
              {/* Right stat */}
              <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(4 * scale) }}>
                <span className="display" style={{ fontSize: Math.round(14 * scale), color: ts.text }}>{row[1].v}</span>
                <span className="mono" style={{ fontSize: Math.round(9 * scale), color: ts.text, opacity: 0.7, letterSpacing: '0.05em' }}>{row[1].k}</span>
              </div>
            </div>
          ))}
        </div>

        {/* MBA label */}
        <div className="mono" style={{ textAlign: 'center', fontSize: Math.round(8 * scale), color: ts.text, opacity: 0.5, letterSpacing: '0.15em', marginTop: Math.round(6 * scale) }}>
          MBA FÚTBOL CLUB
        </div>
      </div>
    </div>
  )
}

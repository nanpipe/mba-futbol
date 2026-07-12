'use client'

export interface MatchBadge {
  badge_id: string
  badge_emoji: string
  badge_nombre: string
  profiles: { username: string } | null
}

export interface MatchResult {
  fecha: string
  dia_semana: string
  hora?: string | null
  foto_url?: string | null
  goles_a?: number | null
  goles_b?: number | null
  tipo?: string | null
  lugar?: string | null
  puntos_blanco?: number | null
  puntos_negro?: number | null
  puntos_morado?: number | null
}

function formatHora12(hora?: string | null): string {
  if (!hora) return ''
  const [h, m] = hora.split(':').map(Number)
  if (isNaN(h)) return ''
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`
}

/**
 * Result block for a finished match: photo, winner (normal score or minitorneo
 * points) and badge winners. Used on the home page (last match) and /historial.
 */
export function MatchResultCard({ titulo, partido, badges }: {
  titulo: string
  partido: MatchResult
  badges: MatchBadge[]
}) {
  const p = partido
  const esMinitorneo = p.tipo === 'minitorneo'
  const hora = formatHora12(p.hora)

  return (
    <div className="fade-in">
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 4 }}>
        {titulo}
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16 }}>
        {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
        {hora && ` · ${hora}`}
        {p.lugar && ` · 📍 ${p.lugar}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {p.foto_url && (
          <div style={{ borderRadius: 6, overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.foto_url}
              alt="Foto del partido"
              style={{ width: '100%', display: 'block', maxHeight: 400, objectFit: 'contain' }}
            />
          </div>
        )}
        {(() => {
          if (esMinitorneo && p.puntos_blanco != null) {
            const pts = [
              { label: 'Blancos 🤍', pts: p.puntos_blanco ?? 0 },
              { label: 'Negros 🖤', pts: p.puntos_negro ?? 0 },
              { label: 'Morados 💜', pts: p.puntos_morado ?? 0 },
            ]
            const winner = pts.reduce((a, b) => b.pts > a.pts ? b : a)
            return (
              <div style={{ padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 4 }}>GANADOR DEL PARTIDO</div>
                  <div className="display" style={{ fontSize: 20 }}>{winner.label}</div>
                </div>
                <div className="mono" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  B{p.puntos_blanco} · N{p.puntos_negro} · M{p.puntos_morado}
                </div>
              </div>
            )
          }
          if (!esMinitorneo && p.goles_a != null && p.goles_b != null) {
            const winnerLabel = p.goles_a > p.goles_b ? 'Equipo Blanco 🤍' : p.goles_b > p.goles_a ? 'Equipo Negro 🖤' : 'Empate'
            return (
              <div style={{ padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 4 }}>GANADOR DEL PARTIDO</div>
                  <div className="display" style={{ fontSize: 20 }}>{winnerLabel}</div>
                </div>
                <div className="display" style={{ fontSize: 24, color: 'var(--green)' }}>
                  {p.goles_a} – {p.goles_b}
                </div>
              </div>
            )
          }
          return null
        })()}
        {badges.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {badges.map(b => (
              <div key={b.badge_id + (b.profiles?.username ?? '')} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', background: 'var(--bg-card)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{b.badge_emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 1 }}>{b.badge_nombre}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.profiles?.username ?? '?'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

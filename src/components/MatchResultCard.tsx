'use client'

export interface MatchBadge {
  badge_id: string
  badge_emoji: string
  badge_nombre: string
  /** Votos con los que se ganó. null en reconocimientos anteriores al conteo guardado. */
  votos?: number | null
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
export function MatchResultCard({ titulo, partido, badges, marca }: {
  titulo: string
  partido: MatchResult
  badges: MatchBadge[]
  /** Distintivo opcional junto al título (el historial pone ahí GANÓ/PERDIÓ). */
  marca?: React.ReactNode
}) {
  const p = partido
  // Un empate son DOS filas en player_badges, una por ganador. Sin agrupar, la
  // tarjeta repetía la categoría ("La más perrota" dos veces con nombres
  // distintos) y parecía un error de conteo. Agrupadas se lee lo que es.
  const categorias = (() => {
    const porId = new Map<string, { badge_id: string; emoji: string; nombre: string; votos: number | null; ganadores: string[] }>()
    for (const b of badges) {
      const prev = porId.get(b.badge_id)
      const quien = b.profiles?.username ?? '?'
      if (prev) prev.ganadores.push(quien)
      else porId.set(b.badge_id, {
        badge_id: b.badge_id, emoji: b.badge_emoji, nombre: b.badge_nombre,
        votos: b.votos ?? null, ganadores: [quien],
      })
    }
    for (const c of porId.values()) c.ganadores.sort()
    return [...porId.values()]
  })()
  const esMinitorneo = p.tipo === 'minitorneo'
  const hora = formatHora12(p.hora)

  return (
    <div className="fade-in">
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>{titulo}</span>
        {marca}
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16 }}>
        {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
        {hora && ` · ${hora}`}
        {p.lugar && ` · 📍 ${p.lugar}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {p.foto_url && (
          // Desde 2026-09-21 las fotos se suben recortadas a 16:9, así que la
          // caja reserva esa forma y la tarjeta deja de saltar de alto según la
          // foto de cada partido.
          //
          // Las fotos ANTERIORES tienen cualquier proporción, y ahí hay que
          // elegir: `cover` las recortaría (una vertical quedaría en una franja
          // delgada, cortando cabezas) y `contain` las deja completas pero con
          // dos vacíos negros enormes al lado, que se ven como un error.
          //
          // Salida: `contain` sobre un fondo hecho con la MISMA foto ampliada y
          // desenfocada. No se recorta nada, el hueco deja de leerse como un
          // error, y para una foto que ya viene 16:9 el fondo no se ve nunca
          // porque la de adelante lo tapa entero. El admin puede arreglar las
          // viejas de verdad con "✂️ Reencuadrar" en el historial.
          <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', aspectRatio: '16 / 9', background: '#000' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.foto_url}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', filter: 'blur(24px) brightness(0.45)',
                // Sin esto se ven los bordes del desenfoque contra el marco.
                transform: 'scale(1.15)',
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.foto_url}
              alt="Foto del partido"
              loading="lazy"
              decoding="async"
              style={{ position: 'relative', width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
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
        {categorias.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {categorias.map(c => (
              <div key={c.badge_id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', background: 'var(--bg-card)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{c.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 1 }}>
                    {c.nombre}
                    {typeof c.votos === 'number' && (
                      <span style={{ color: 'var(--text-dim)' }}>
                        {' '}· {c.votos} voto{c.votos !== 1 ? 's' : ''}{c.ganadores.length > 1 ? ' c/u' : ''}
                      </span>
                    )}
                    {c.ganadores.length > 1 && (
                      <span style={{ color: 'var(--amber)' }}> · EMPATE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.ganadores.join(' y ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

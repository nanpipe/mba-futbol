'use client'

import { useState, useEffect } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Card } from '@/components/Card'
import { ModalOverlay } from '@/components/ModalOverlay'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ratingTierStyle, formatRating } from '@/lib/tier'
import { fechaColombia } from '@/lib/promoHora'

interface PerfilData {
  perfil: {
    id: string
    username: string
    email: string
    avatar_url: string | null
    created_at: string
    posicion: string | null
    posiciones: string[] | null
    habilidad: number | null
    role: string
    uniform: boolean
    ausente_desde: string | null
    ausente_hasta: string | null
  }
  partidos_jugados: number
  badges: { badge_id: string; badge_emoji: string; badge_nombre: string; votos: number | null; fecha: string | null }[]
  rating_events: { delta: number; rating_after: number; motivos: string[]; fecha: string; dia_semana: string | null }[]
}

const fechaCorta = (f: string | null) =>
  f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : '—'

function Stat({ valor, etiqueta, color }: { valor: string; etiqueta: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
      <div className="display" style={{ fontSize: 24, color }}>{valor}</div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: 2 }}>
        {etiqueta}
      </div>
    </div>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>
        {titulo}
      </div>
      {children}
    </div>
  )
}

/**
 * Ficha de un jugador para el panel: lo mismo que él ve en su perfil, más el
 * historial de rating. Solo lectura — lo que se cambia va en el modal de editar.
 */
export function PerfilJugadorModal({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const [data, setData] = useState<PerfilData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    fetch(`/api/admin?accion=perfil_jugador&player_id=${playerId}`)
      .then(r => r.json())
      .then(d => { if (!vivo) return; d.ok ? setData(d) : setError(d.error ?? 'No se pudo cargar') })
      .catch(() => { if (vivo) setError('No se pudo cargar') })
    return () => { vivo = false }
  }, [playerId])

  const p = data?.perfil
  const hoy = fechaColombia()
  const ausente = !!p?.ausente_hasta && p.ausente_hasta >= hoy
  const tier = p ? ratingTierStyle(p.habilidad ?? 3) : null

  // Cuántos reconocimientos de cada tipo: más útil que la lista cruda cuando
  // alguien acumula el mismo varias veces.
  const porTipo = new Map<string, { emoji: string; nombre: string; n: number }>()
  for (const b of data?.badges ?? []) {
    const prev = porTipo.get(b.badge_id)
    if (prev) prev.n++
    else porTipo.set(b.badge_id, { emoji: b.badge_emoji, nombre: b.badge_nombre, n: 1 })
  }

  return (
    <ModalOverlay>
      <Card style={{ width: '100%', maxWidth: 460, margin: 'auto', overflowY: 'auto', maxHeight: '85vh' }} padding={24}>
        {error ? (
          <div className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>{error}</div>
        ) : !data || !p ? (
          <LoadingSpinner />
        ) : (
          <>
            {/* Cabecera */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <PlayerAvatar url={p.avatar_url} username={p.username} size={56} />
              <div style={{ minWidth: 0 }}>
                <div className="display" style={{ fontSize: 22 }}>{p.username}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
                  Desde {fechaCorta(p.created_at.slice(0, 10))}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  {p.role !== 'player' && (
                    <span className="mono" style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.1em', background: '#1a0a2e', border: '1px solid #7c3aed', padding: '2px 5px', borderRadius: 2 }}>
                      {p.role.toUpperCase()}
                    </span>
                  )}
                  {p.uniform && (
                    <span className="mono" style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '0.1em', background: '#0f2d1a', padding: '2px 5px', borderRadius: 2 }}>UNIFORME</span>
                  )}
                  {ausente && (
                    <span className="mono" style={{ fontSize: 9, color: '#7dd3fc', letterSpacing: '0.1em', background: '#082f49', border: '1px solid #0369a1', padding: '2px 5px', borderRadius: 2 }}>
                      ✈️ AUSENTE · {fechaCorta(p.ausente_hasta)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div style={{
              display: 'flex', gap: 8, padding: '14px 0',
              borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            }}>
              <Stat valor={String(data.partidos_jugados)} etiqueta="PARTIDOS" color="var(--green)" />
              <Stat valor={String(data.badges.length)} etiqueta="RECONOCIMIENTOS" color="var(--amber)" />
              <Stat valor={`★${formatRating(p.habilidad)}`} etiqueta={tier?.label.toUpperCase() ?? 'RATING'} />
            </div>

            {/* Posiciones */}
            {(p.posiciones?.length || p.posicion) && (
              <Bloque titulo="POSICIONES">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(p.posiciones?.length ? p.posiciones : [p.posicion!]).map(pos => (
                    <span key={pos} className="mono" style={{
                      fontSize: 10, padding: '4px 9px', borderRadius: 2,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      color: 'var(--text-muted)', letterSpacing: '0.06em',
                    }}>
                      {pos}
                    </span>
                  ))}
                </div>
              </Bloque>
            )}

            {/* Reconocimientos */}
            <Bloque titulo={`RECONOCIMIENTOS (${data.badges.length})`}>
              {porTipo.size === 0 ? (
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Todavía no tiene ninguno.</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[...porTipo.values()].sort((a, b) => b.n - a.n).map(t => (
                    <span key={t.nombre} className="mono" style={{
                      fontSize: 11, padding: '4px 9px', borderRadius: 2,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    }}>
                      {t.emoji} {t.nombre}
                      {t.n > 1 && <span style={{ color: 'var(--amber)', marginLeft: 5 }}>×{t.n}</span>}
                    </span>
                  ))}
                </div>
              )}
            </Bloque>

            {/* Historial de rating — el "por qué" del número de arriba */}
            <Bloque titulo="MOVIMIENTOS DE RATING">
              {data.rating_events.length === 0 ? (
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  Sin movimientos todavía.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {data.rating_events.map((e, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'baseline', gap: 10,
                      padding: '7px 10px', background: 'var(--bg-card)',
                      border: '1px solid var(--border)', borderRadius: 3,
                    }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', width: 52, flexShrink: 0 }}>
                        {fechaCorta(e.fecha)}
                      </span>
                      <span className="mono" style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', minWidth: 0 }}>
                        {e.motivos.join(' · ') || '—'}
                      </span>
                      <span className="mono" style={{
                        fontSize: 11, flexShrink: 0, width: 46, textAlign: 'right',
                        color: e.delta > 0 ? 'var(--green)' : e.delta < 0 ? '#f87171' : 'var(--text-dim)',
                      }}>
                        {e.delta > 0 ? '+' : ''}{e.delta.toFixed(3)}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', width: 34, textAlign: 'right', flexShrink: 0 }}>
                        {e.rating_after.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
                    Últimos {data.rating_events.length}, del más reciente al más viejo.
                  </div>
                </div>
              )}
            </Bloque>

            <button onClick={onClose} className="btn btn-ghost" style={{ width: '100%', marginTop: 22, justifyContent: 'center' }}>
              Cerrar
            </button>
          </>
        )}
        {(error || !data) && (
          <button onClick={onClose} className="btn btn-ghost" style={{ width: '100%', marginTop: 18, justifyContent: 'center' }}>
            Cerrar
          </button>
        )}
      </Card>
    </ModalOverlay>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Card } from '@/components/Card'
import { ModalOverlay } from '@/components/ModalOverlay'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ratingTierStyle, formatRating } from '@/lib/tier'
import { fechaColombia } from '@/lib/promoHora'
import { diasDesde } from '@/lib/asistencia'
import { agruparBadges } from '@/lib/categorias'

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
  asistencia: {
    jugados: number
    posibles: number
    porcentaje: number | null
    ultimo_jugado: string | null
    partidos_desde_ultimo: number
    racha_jugados: number
    racha_faltas: number
  }
  faltas_gap: number
  badges: { badge_id: string; badge_emoji: string; badge_nombre: string; votos: number | null; fecha: string | null }[]
}

const fechaCorta = (f: string | null) =>
  f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : '—'

function Stat({ valor, etiqueta, color }: { valor: string; etiqueta: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div className="display" style={{ fontSize: 26, color, lineHeight: 1.1 }}>{valor}</div>
      <div className="mono" style={{
        fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.08em', marginTop: 4,
        // Una etiqueta larga parte de línea en vez de meterse debajo de la vecina.
        overflowWrap: 'anywhere', lineHeight: 1.3,
      }}>
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
 * Ficha de un jugador para el panel. Solo lectura — lo que se cambia va en el
 * modal de editar.
 *
 * No muestra el historial partido por partido a propósito: eso ya pasó y el
 * rating lo resume. Lo que se muestra es dónde está parado hoy — si viene
 * seguido, si desapareció y hace cuánto, y si ya le está costando rating.
 */
export function PerfilJugadorModal({ playerId, onClose, onEditar }: {
  playerId: string
  onClose: () => void
  /** Abre el modal de editar con este jugador. La lista ya no tiene botón de
      editar por fila: se entra por acá, que es donde se ve a quién se le va a
      cambiar algo. */
  onEditar?: () => void
}) {
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

  // ── Estado actual ─────────────────────────────────────────────────────────
  // Una sola frase que diga si hay algo que hacer con este jugador. El
  // historial partido por partido no se muestra: eso ya pasó y el rating lo
  // resume. Lo que sirve es dónde está parado hoy.
  const a = data?.asistencia
  const gap = data?.faltas_gap ?? 3
  const estado = (() => {
    const gris  = { color: 'var(--text-muted)', fondo: 'var(--bg-elevated)', borde: 'var(--border)' }
    const verde = { color: 'var(--green)',      fondo: '#0f2d1a',           borde: '#166534' }
    const azul  = { color: '#7dd3fc',           fondo: '#082f49',           borde: '#0369a1' }
    const ambar = { color: 'var(--amber)',      fondo: '#2d1f00',           borde: '#92400e' }
    const rojo  = { color: '#f87171',           fondo: '#1a0808',           borde: '#7f1d1d' }

    if (!a) return { ...gris, titulo: '', detalle: '' }

    if (ausente) {
      return { ...azul, titulo: `✈️ Ausente hasta el ${fechaCorta(p!.ausente_hasta)}`,
        detalle: 'No pierde puntaje por no inscribirse mientras dure.' }
    }
    if (a.posibles === 0) {
      return { ...gris, titulo: 'Recién llegado', detalle: 'Todavía no ha habido un partido desde que entró.' }
    }
    if (a.ultimo_jugado === null) {
      return { ...rojo, titulo: `Nunca ha jugado`,
        detalle: `${a.posibles} partido${a.posibles !== 1 ? 's' : ''} desde que entró al club.` }
    }
    if (a.racha_faltas === 0) {
      const r = a.racha_jugados
      return { ...verde, titulo: r > 1 ? `🔥 ${r} partidos seguidos` : 'Jugó el último partido',
        detalle: r > 1 ? 'Viene en racha.' : '' }
    }
    // Faltando: lo importante es hace cuánto y si ya le está costando.
    const dias = diasDesde(a.ultimo_jugado, hoy)
    const titulo = `No juega hace ${dias} día${dias !== 1 ? 's' : ''}` +
      ` (${a.partidos_desde_ultimo} partido${a.partidos_desde_ultimo !== 1 ? 's' : ''})`
    const detalle = a.racha_faltas >= gap
      ? `${a.racha_faltas} faltas seguidas — ya le está restando rating en cada partido.`
      : `${a.racha_faltas} de ${gap} faltas seguidas. ` +
        `${gap - a.racha_faltas === 1 ? 'A la próxima' : `En ${gap - a.racha_faltas} más`} empieza a restarle rating.`
    return a.racha_faltas >= gap ? { ...rojo, titulo, detalle } : { ...ambar, titulo, detalle }
  })()

  // Misma función que el perfil del jugador, para que no se vean distintos.
  const agrupados = agruparBadges(data?.badges ?? [])

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

            {/* Stats — 2×2. En una sola fila, "RECONOCIMIENTOS" y el nombre del
                tier se pisan en pantalla de teléfono. */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 8px',
              padding: '16px 0',
              borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            }}>
              <Stat valor={String(data.asistencia.jugados)} etiqueta="PARTIDOS" color="var(--green)" />
              <Stat valor={data.asistencia.porcentaje === null ? '—' : `${data.asistencia.porcentaje}%`} etiqueta="ASISTENCIA" />
              <Stat valor={String(data.badges.length)} etiqueta="RECONOCIMIENTOS" color="var(--amber)" />
              <Stat valor={`★${formatRating(p.habilidad)}`} etiqueta={tier?.label.toUpperCase() ?? 'RATING'} />
            </div>

            {/* Estado actual — lo único que es accionable */}
            <div style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 4,
              background: estado.fondo, border: `1px solid ${estado.borde}`,
            }}>
              <div className="mono" style={{ fontSize: 13, color: estado.color, lineHeight: 1.5 }}>
                {estado.titulo}
              </div>
              {estado.detalle && (
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5, lineHeight: 1.6 }}>
                  {estado.detalle}
                </div>
              )}
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
              {agrupados.length === 0 ? (
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Todavía no tiene ninguno.</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {agrupados.map(t => (
                    <span key={t.badge_id} className="mono" style={{
                      fontSize: 11, padding: '4px 9px', borderRadius: 2,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    }}>
                      {t.emoji} {t.nombre}
                      {t.veces > 1 && <span style={{ color: 'var(--amber)', marginLeft: 5 }}>×{t.veces}</span>}
                    </span>
                  ))}
                </div>
              )}
            </Bloque>

            {a && a.ultimo_jugado && (
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 18 }}>
                Último partido jugado: {fechaCorta(a.ultimo_jugado)} · {a.jugados} de {a.posibles} desde que entró
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              {onEditar && (
                <button onClick={onEditar} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
                  Editar
                </button>
              )}
              <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
                Cerrar
              </button>
            </div>
          </>
        )}
        {/* Editar también acá: la lista ya no tiene botón de editar por fila,
            así que una ficha que no carga dejaría al admin sin ninguna forma
            de llegar a editar a ese jugador. */}
        {(error || !data) && (
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            {onEditar && (
              <button onClick={onEditar} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
                Editar
              </button>
            )}
            <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
              Cerrar
            </button>
          </div>
        )}
      </Card>
    </ModalOverlay>
  )
}

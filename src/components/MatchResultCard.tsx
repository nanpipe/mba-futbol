'use client'

import { useState } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { formatDelta, explicarMotivo } from '@/lib/puntaje'

export interface MatchBadge {
  badge_id: string
  badge_emoji: string
  badge_nombre: string
  /** Votos con los que se ganó. null en reconocimientos anteriores al conteo guardado. */
  votos?: number | null
  profiles: { username: string; avatar_url?: string | null } | null
  /** Color del equipo en que jugó. Opcional: no toda pantalla lo carga. */
  equipo_color?: string | null
}

// El punto de equipo NO usa el color literal: sobre fondo negro un punto negro
// no se ve. El "negro" va gris medio con anillo claro, que sí se distingue.
const COLOR_EQUIPO: Record<string, { fondo: string; borde: string }> = {
  blanco: { fondo: '#e5e5e5', borde: 'rgba(0,0,0,0.35)' },
  negro:  { fondo: '#4a4a4a', borde: 'rgba(255,255,255,0.55)' },
  morado: { fondo: '#a78bfa', borde: 'rgba(255,255,255,0.25)' },
}

function PuntoEquipo({ color }: { color?: string | null }) {
  const c = color ? COLOR_EQUIPO[color] : undefined
  if (!c) return null
  return (
    <span
      title={`Equipo ${color}`}
      style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: c.fondo, border: `1px solid ${c.borde}`,
      }}
    />
  )
}

/** Lo que se movió el puntaje de un jugador en este partido (rating_events). */
export interface MovimientoPuntaje {
  player_id: string
  username: string
  delta: number
  motivos: string[]
}

/**
 * Quién subió y quién bajó con este partido.
 *
 * Existe porque el puntaje se movía en silencio: la gente veía su número
 * distinto el jueves y no tenía forma de saber por qué. Acá queda el renglón
 * exacto — "ganó, 🏆 MVP, 4 👍" — al lado de la cifra.
 *
 * Va plegado: son 14 jugadores por partido y el historial muestra 15 partidos
 * seguidos. Plegado se ve lo único que casi todos vienen a mirar, que es lo
 * propio, y el resto queda a un toque.
 */
function MovimientoDelPartido({ movimientos, miId }: {
  movimientos: MovimientoPuntaje[]
  miId?: string | null
}) {
  const [abierto, setAbierto] = useState(false)

  // Los que jugaron salen todos, aunque hayan quedado en 0.00 (empatar y no
  // ganar nada ES el resultado, y esconderlo parecería que faltan datos). De
  // los que no jugaron solo salen los que perdieron algo por inactividad: los
  // demás son el club entero con un 0.00 al lado.
  const filas = movimientos
    .filter(m => m.motivos.includes('jugó') || m.delta !== 0)
    .sort((a, b) => b.delta - a.delta || a.username.localeCompare(b.username))

  if (filas.length === 0) return null
  const mio = miId ? filas.find(m => m.player_id === miId) : undefined

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      <button
        onClick={() => setAbierto(a => !a)}
        className="mono"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', background: 'var(--bg-card)', border: 'none',
          color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.12em',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>PUNTAJE DEL PARTIDO</span>
        {mio && (
          <span style={{ letterSpacing: 0, fontSize: 11 }}>
            <span style={{ color: 'var(--text-dim)' }}>TÚ </span>
            <span style={{ color: color(mio.delta) }}>{formatDelta(mio.delta)}</span>
          </span>
        )}
        <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {filas.map(m => (
            <div
              key={m.player_id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
                background: m.player_id === miId ? 'var(--bg-elevated)' : 'transparent',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.username}
                </div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.5 }}>
                  {m.motivos.map(explicarMotivo).join(' · ')}
                </div>
              </div>
              <span className="mono" style={{ fontSize: 12, color: color(m.delta), flexShrink: 0 }}>
                {formatDelta(m.delta)}
              </span>
            </div>
          ))}
          <div className="mono" style={{ fontSize: 10, padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
            <a href="/puntaje" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              ¿Cómo se calcula? Simula tu puntaje →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

const color = (n: number) => (n > 0 ? 'var(--green)' : n < 0 ? '#f87171' : 'var(--text-dim)')

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
export function MatchResultCard({ titulo, partido, badges, marca, movimientos, miId }: {
  titulo: string
  partido: MatchResult
  badges: MatchBadge[]
  /** Distintivo opcional junto al título (el historial pone ahí GANÓ/PERDIÓ). */
  marca?: React.ReactNode
  /** Cuánto subió o bajó cada quien. Vacío mientras las votaciones no cierren. */
  movimientos?: MovimientoPuntaje[]
  /** Para resaltar la fila propia. */
  miId?: string | null
}) {
  const p = partido
  // Un empate son DOS filas en player_badges, una por ganador. Sin agrupar, la
  // tarjeta repetía la categoría ("La más perrota" dos veces con nombres
  // distintos) y parecía un error de conteo. Agrupadas se lee lo que es.
  type Ganador = { username: string; avatar_url: string | null; color: string | null }
  const categorias = (() => {
    const porId = new Map<string, { badge_id: string; emoji: string; nombre: string; votos: number | null; ganadores: Ganador[] }>()
    for (const b of badges) {
      const g: Ganador = {
        username: b.profiles?.username ?? '?',
        avatar_url: b.profiles?.avatar_url ?? null,
        color: b.equipo_color ?? null,
      }
      const prev = porId.get(b.badge_id)
      if (prev) prev.ganadores.push(g)
      else porId.set(b.badge_id, {
        badge_id: b.badge_id, emoji: b.badge_emoji, nombre: b.badge_nombre,
        votos: b.votos ?? null, ganadores: [g],
      })
    }
    for (const c of porId.values()) c.ganadores.sort((x, y) => x.username.localeCompare(y.username))
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
        {/* Los reconocimientos van en rejilla y no en una fila por categoría.
            Con cinco reconocimientos la lista medía 282 px y empujaba el resto
            del partido fuera de pantalla; así mide 126 px, medido en Chromium
            a 360, 390 y 430 px de ancho. El `auto-fill` decide solo cuántas
            columnas caben, así que en un celular angosto baja a una.

            Se conserva el nombre de la categoría a propósito: "La más
            perrota", "El salao" y "Tronco" son el chiste del grupo, y una
            versión solo-emoji bajaba a 53 px pero volvía la tarjeta una
            adivinanza. */}
        {categorias.length > 0 && (
          // `minmax(215px)` y no 150: a 150 se mochaban los nombres y las
          // categorías ("mendieta…", "Mejor Porter…"), que es justo lo que hay
          // que leer. Con menos columnas pero enteras se lee mejor que con
          // muchas cortadas.
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 6 }}>
            {categorias.map(c => {
              const empate = c.ganadores.length > 1
              return (
                <div key={c.badge_id} style={{
                  display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                  padding: '8px 10px', background: 'var(--bg-card)',
                  border: '1px solid var(--border)', borderRadius: 4,
                }}>
                  <span style={{ fontSize: 19, flexShrink: 0 }}>{c.emoji}</span>
                  {/* En un empate se muestran TODOS los ganadores, no "+1": el
                      empate es la gracia del asunto y esconder a uno de los dos
                      detrás de un contador se lee como si hubiera un solo
                      ganador. Los avatares se superponen para ocupar poco. */}
                  <div style={{ display: 'flex', flexShrink: 0 }}>
                    {c.ganadores.map((g, i) => (
                      <span key={g.username} style={{ marginLeft: i ? -9 : 0, display: 'inline-flex' }}>
                        <PlayerAvatar url={g.avatar_url} username={g.username} size={26} />
                      </span>
                    ))}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mono" style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.ganadores.map(g => g.username).join(' · ')}
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.nombre}
                      {typeof c.votos === 'number' && ` · ${c.votos}`}
                      {empate && <span style={{ color: 'var(--amber)' }}> · EMPATE</span>}
                    </div>
                  </div>
                  <PuntoEquipo color={c.ganadores[0].color} />
                </div>
              )
            })}
          </div>
        )}
        {movimientos && movimientos.length > 0 && (
          <MovimientoDelPartido movimientos={movimientos} miId={miId} />
        )}
      </div>
    </div>
  )
}

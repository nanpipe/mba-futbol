'use client'

import { useEffect, useState } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SectionHeader } from '@/components/SectionHeader'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { formatoPesos, type ResumenFondo } from '@/lib/fondo'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "4 ago 2026" — a mano, sin toLocaleDateString (ver skill ui-movil). */
function fechaCorta(fecha: string, conAnio = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m) return fecha
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}${conAnio ? ` ${m[1]}` : ''}`
}

const MEDALLA: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

/**
 * Fondo MBA: lo que cada jugador ha aportado desde el primer partido.
 *
 * Es un ranking a propósito — el club lo pidió así: quién ha puesto más. La
 * barra de cada fila es proporcional al primero, para que la distancia entre
 * puestos se vea sin leer los números.
 */
export function TabFondo() {
  const [datos, setDatos] = useState<(ResumenFondo & { aporte: number }) | null>(null)
  const [error, setError] = useState('')
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const [verExplicacion, setVerExplicacion] = useState(false)

  useEffect(() => {
    fetch('/api/admin?accion=fondo')
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d.ok) setError(d.error ?? 'No se pudo cargar el fondo')
        else setDatos(d)
      })
      .catch(() => setError('No se pudo cargar el fondo'))
  }, [])

  if (error) return <div className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>{error}</div>
  if (!datos) return <LoadingSpinner text="CARGANDO..." />

  const max = datos.ranking[0]?.total ?? 0

  return (
    <div className="fade-in" style={{ maxWidth: 720 }}>
      {/* ── El total ── */}
      <div style={{
        padding: '18px 18px 16px', marginBottom: 28, borderRadius: 6,
        background: 'var(--bg-card)', border: '1px solid #166534',
      }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
          FONDO MBA
        </div>
        <div className="display" style={{ fontSize: 44, lineHeight: 1.1, color: 'var(--green)', marginTop: 6 }}>
          {formatoPesos(datos.total)}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
          {datos.partidos} partido{datos.partidos !== 1 ? 's' : ''} · {datos.aportes} aportes
          {datos.desde && <> · desde el {fechaCorta(datos.desde, true)}</>}
        </div>

        {/* La cuenta es teórica y la pantalla tiene que decirlo: si no, el
            número se lee como plata que alguien tiene guardada. */}
        <button
          onClick={() => setVerExplicacion(v => !v)}
          className="mono"
          style={{
            marginTop: 12, padding: 0, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--text-dim)', textAlign: 'left',
          }}
        >
          {verExplicacion ? '▲' : '▼'} ¿De dónde sale?
        </button>
        {verExplicacion && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7, marginTop: 8 }}>
            La cancha cuesta $ 140.000. El equipo que gana paga $ 9.000 por persona y el que pierde $ 13.000:
            entre los 14 juntan $ 154.000 y sobran <strong style={{ color: 'var(--text-muted)' }}>$ 14.000</strong>,
            que van al fondo.
            <br /><br />
            Repartido parejo son <strong style={{ color: 'var(--text-muted)' }}>{formatoPesos(datos.aporte)} por persona y por partido</strong>,
            y así se cuenta acá. Es una cuenta teórica: en la realidad el que gana aporta un poco más que el que pierde.
            <br /><br />
            Cuenta todo partido que se jugó desde que existe la app, aunque no tenga marcador cargado: la cancha se pagó igual.
          </div>
        )}
      </div>

      {/* ── Ranking ── */}
      <SectionHeader title="Quién ha aportado" count={datos.ranking.length} color="var(--text-muted)" />

      {datos.ranking.length === 0 ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>Todavía no hay partidos jugados.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {datos.ranking.map(a => {
            const abierto = abiertoId === a.player_id
            const podio = a.puesto <= 3
            return (
              <div key={a.player_id} style={{
                background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden',
                border: `1px solid ${abierto ? 'var(--green)' : 'var(--border)'}`,
              }}>
                <button
                  onClick={() => setAbiertoId(abierto ? null : a.player_id)}
                  aria-expanded={abierto}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px 8px', background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                  }}
                >
                  <span className="mono" style={{
                    width: 26, flexShrink: 0, textAlign: 'center',
                    fontSize: podio ? 20 : 12, color: 'var(--text-dim)',
                  }}>
                    {MEDALLA[a.puesto] ?? a.puesto}
                  </span>
                  <PlayerAvatar url={a.avatar_url} username={a.username} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.username}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      {a.partidos} partido{a.partidos !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 14, color: podio ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }}>
                    {formatoPesos(a.total)}
                  </span>
                </button>

                {/* Barra proporcional al primero. */}
                <div style={{ height: 3, margin: '0 12px 10px 48px', background: 'var(--bg-elevated)', borderRadius: 2 }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: `${max ? Math.max(2, (a.total / max) * 100) : 0}%`,
                    background: podio ? 'var(--green)' : '#2f5d3f',
                  }} />
                </div>

                {abierto && (
                  <div style={{ padding: '0 12px 12px 48px' }}>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Desde el {fechaCorta(a.primera, true)} · último el {fechaCorta(a.ultima, true)}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {a.fechas.map(f => (
                        <span key={f} className="mono" style={{
                          fontSize: 10, padding: '3px 7px', borderRadius: 2,
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                        }}>
                          {fechaCorta(f)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {datos.invitados.aportes > 0 && (
        <div className="mono" style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 4, fontSize: 12,
          border: '1px dashed var(--border)', color: 'var(--text-muted)',
          display: 'flex', justifyContent: 'space-between', gap: 10,
        }}>
          <span>Invitados · {datos.invitados.aportes} aporte{datos.invitados.aportes !== 1 ? 's' : ''}</span>
          <span>{formatoPesos(datos.invitados.total)}</span>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { MatchResultCard, type MatchBadge, type MatchResult } from '@/components/MatchResultCard'
import { RESULTADOS, type Resultado, type Relacion, type Ficha } from '@/lib/historial'

interface PartidoHistorial extends MatchResult {
  id: string
  player_badges: MatchBadge[]
  /** Cómo le fue al jugador filtrado. null si no hay jugador, o si no se sabe. */
  mi_resultado: Resultado | null
}

interface Respuesta {
  partidos: PartidoHistorial[]
  ficha: Ficha | null
  cruce: { con: number; contra: number } | null
  hay_mas: boolean
  desde_minimo: string | null
}

interface Jugador { id: string; username: string }

const TAM = 15

const COLOR: Record<Resultado, string> = {
  'ganó': 'var(--green)',
  'perdió': '#f87171',
  'empató': 'var(--amber)',
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3,
  color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 12,
  padding: '7px 10px', minWidth: 0, flex: '1 1 140px',
}

function Chip({ activo, onClick, color, children }: {
  activo: boolean; onClick: () => void; color?: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        padding: '6px 12px', fontSize: 11, cursor: 'pointer', borderRadius: 3,
        letterSpacing: '0.06em', whiteSpace: 'nowrap',
        border: `1px solid ${activo ? (color ?? 'var(--green)') : 'var(--border)'}`,
        background: activo ? 'var(--bg-elevated)' : 'transparent',
        color: activo ? (color ?? 'var(--green)') : 'var(--text-dim)',
      }}
    >
      {children}
    </button>
  )
}

/**
 * Historial del club, filtrable.
 *
 * Todo el filtrado ocurre en el servidor (`/api/historial`). Filtrar en el
 * cliente lo que llegó paginado daría totales falsos: "28 ganados" saldría de
 * los 15 partidos cargados, no de la historia.
 */
export default function HistorialPage() {
  const supabase = createClient()

  const [jugadores, setJugadores] = useState<Jugador[]>([])
  const [jugador, setJugador] = useState('')
  const [rival, setRival] = useState('')
  const [relacion, setRelacion] = useState<Relacion | ''>('')
  const [resultado, setResultado] = useState<Resultado | ''>('')
  const [anio, setAnio] = useState('')

  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [extra, setExtra] = useState<PartidoHistorial[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return }
      supabase.from('profiles')
        .select('id, username')
        .eq('aprobado', true).eq('baneado', false)
        .order('username')
        .then(({ data }) => setJugadores((data as Jugador[]) ?? []))
    })
  }, [supabase])

  const query = useCallback((desdeOffset: number) => {
    const q = new URLSearchParams({ tam: String(TAM), offset: String(desdeOffset) })
    if (jugador) q.set('jugador', jugador)
    if (jugador && rival) q.set('rival', rival)
    if (jugador && rival && relacion) q.set('relacion', relacion)
    if (jugador && resultado) q.set('resultado', resultado)
    if (anio) { q.set('desde', `${anio}-01-01`); q.set('hasta', `${anio}-12-31`) }
    return q.toString()
  }, [jugador, rival, relacion, resultado, anio])

  // Cambiar cualquier filtro reinicia la paginación: mezclar páginas de
  // filtros distintos mostraría partidos que ya no corresponden.
  useEffect(() => {
    let vigente = true
    setLoading(true); setError(''); setExtra([]); setOffset(0)
    fetch(`/api/historial?${query(0)}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!vigente) return
        if (!r.ok) { setError(d.error ?? 'No se pudo cargar el historial'); setDatos(null) }
        else setDatos(d as Respuesta)
      })
      .catch(() => { if (vigente) setError('No se pudo cargar el historial') })
      .finally(() => { if (vigente) setLoading(false) })
    return () => { vigente = false }
  }, [query])

  const cargarMas = async () => {
    if (!datos) return
    setCargandoMas(true)
    const siguiente = offset + TAM
    try {
      const r = await fetch(`/api/historial?${query(siguiente)}`)
      const d = await r.json()
      if (r.ok) {
        setExtra(prev => [...prev, ...(d.partidos as PartidoHistorial[])])
        setOffset(siguiente)
        setDatos(prev => prev ? { ...prev, hay_mas: d.hay_mas } : prev)
      }
    } finally {
      setCargandoMas(false)
    }
  }

  const anios = useMemo(() => {
    const hasta = new Date().getFullYear()
    const desde = datos?.desde_minimo ? Number(datos.desde_minimo.slice(0, 4)) : hasta
    const out: number[] = []
    for (let a = hasta; a >= desde; a--) out.push(a)
    return out
  }, [datos?.desde_minimo])

  const lista = datos ? [...datos.partidos, ...extra] : []
  const nombre = jugadores.find(j => j.id === jugador)?.username ?? ''
  const nombreRival = jugadores.find(j => j.id === rival)?.username ?? ''
  const f = datos?.ficha

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 60 }}>
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 30 }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
          <span className="display" style={{ fontSize: 18, letterSpacing: '0.08em' }}>HISTORIAL</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 20, maxWidth: 560 }}>

        {/* ── Filtros ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={jugador}
              onChange={e => { setJugador(e.target.value); setRival(''); setRelacion(''); setResultado('') }}
              style={selectStyle}
              aria-label="Jugador"
            >
              <option value="">Todo el club</option>
              {jugadores.map(j => <option key={j.id} value={j.id}>{j.username}</option>)}
            </select>
            <select value={anio} onChange={e => setAnio(e.target.value)} style={{ ...selectStyle, flex: '0 1 110px' }} aria-label="Año">
              <option value="">Siempre</option>
              {anios.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* El resultado solo existe con jugador: un partido no lo gana el
              club, lo gana un equipo. */}
          {jugador && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip activo={resultado === ''} onClick={() => setResultado('')}>TODOS</Chip>
              {RESULTADOS.map(r => (
                <Chip key={r} activo={resultado === r} color={COLOR[r]} onClick={() => setResultado(resultado === r ? '' : r)}>
                  {r.toUpperCase()}
                </Chip>
              ))}
            </div>
          )}

          {jugador && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={rival}
                onChange={e => { setRival(e.target.value); setRelacion('') }}
                style={selectStyle}
                aria-label="Comparar con otro jugador"
              >
                {/* Sin emoji a propósito: ⚔ no tiene glifo en todas las
                    fuentes y cae a "×", que en un selector parece un botón
                    de borrar. Se vio así al renderizar la pantalla. */}
                <option value="">Comparar con…</option>
                {jugadores.filter(j => j.id !== jugador).map(j => (
                  <option key={j.id} value={j.id}>{j.username}</option>
                ))}
              </select>
              {rival && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <Chip activo={relacion === 'con'} onClick={() => setRelacion(relacion === 'con' ? '' : 'con')}>JUNTOS</Chip>
                  <Chip activo={relacion === 'contra'} color="#f87171" onClick={() => setRelacion(relacion === 'contra' ? '' : 'contra')}>EN CONTRA</Chip>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Ficha del jugador ── */}
        {f && !loading && (
          <div style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>
              {nombre.toUpperCase()}
              {nombreRival && ` VS ${nombreRival.toUpperCase()}`}
              {anio && ` · ${anio}`}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <span className="display" style={{ fontSize: 26 }}>{f.jugados}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}> jugados</span>
              </div>
              <div className="mono" style={{ fontSize: 13 }}>
                <span style={{ color: COLOR['ganó'] }}>{f.ganados}G</span>
                <span style={{ color: 'var(--text-muted)' }}> · </span>
                <span style={{ color: COLOR['perdió'] }}>{f.perdidos}P</span>
                <span style={{ color: 'var(--text-muted)' }}> · </span>
                <span style={{ color: COLOR['empató'] }}>{f.empatados}E</span>
              </div>
              {f.pct_victorias !== null ? (
                <div className="display" style={{ fontSize: 18, color: 'var(--green)', marginLeft: 'auto' }}>
                  {f.pct_victorias}%
                </div>
              ) : f.decididos > 0 ? (
                // Con tres partidos, un 0-1-2 saldría como "0.0%" y marcaría a
                // alguien como el peor del club por pura mala suerte. Los
                // conteos de arriba siguen ahí: son el dato sin interpretar.
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto', textAlign: 'right' }}>
                  pocos partidos<br />para un %
                </div>
              ) : null}
            </div>

            {/* Honestidad sobre la cobertura: no se disimulan los partidos en
                los que no se guardaron equipos y no se puede saber quién ganó. */}
            {f.sin_datos > 0 && (
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
                {f.sin_datos} {f.sin_datos === 1 ? 'partido no cuenta' : 'partidos no cuentan'} para el marcador:
                no quedaron guardados los equipos, así que no se puede saber quién ganó.
                {f.pct_victorias !== null && ` El ${f.pct_victorias}% es sobre los ${f.ganados + f.perdidos + f.empatados} que sí se saben.`}
              </div>
            )}

            {datos?.cruce && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                Juntos <strong style={{ color: 'var(--text)' }}>{datos.cruce.con}</strong>
                {' · '}En contra <strong style={{ color: 'var(--text)' }}>{datos.cruce.contra}</strong>
              </div>
            )}
          </div>
        )}

        {/* ── Lista ── */}
        {loading ? (
          <LoadingSpinner text="CARGANDO..." />
        ) : error ? (
          <div className="mono" style={{ fontSize: 12, color: 'var(--amber)', textAlign: 'center', paddingTop: 30 }}>{error}</div>
        ) : lista.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 30 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {jugador
                ? 'Ningún partido con esos filtros.'
                : 'Aún no hay partidos con resultados registrados.'}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
              {lista.map(p => (
                <MatchResultCard
                  key={p.id}
                  titulo={`${p.tipo === 'minitorneo' ? '🏆 MINITORNEO — ' : ''}${p.dia_semana.toUpperCase()}`}
                  partido={p}
                  badges={p.player_badges ?? []}
                  marca={p.mi_resultado ? (
                    <span style={{ color: COLOR[p.mi_resultado], letterSpacing: '0.1em' }}>
                      {p.mi_resultado.toUpperCase()}
                    </span>
                  ) : null}
                />
              ))}
            </div>
            {datos?.hay_mas && (
              <div style={{ textAlign: 'center', marginTop: 32 }}>
                <button onClick={cargarMas} disabled={cargandoMas} className="btn btn-ghost" style={{ padding: '10px 24px', fontSize: 12 }}>
                  {cargandoMas ? 'Cargando...' : 'Cargar más'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

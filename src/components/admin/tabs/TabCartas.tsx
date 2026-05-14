'use client'

import { useState, useCallback, useEffect } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'

const STATS = ['res', 'fis', 'def', 'ata', 'tec', 'dis'] as const
type Stat = typeof STATS[number]

interface Props {
  active: boolean
}

export function TabCartas({ active }: Props) {
  const [cartas, setCartas] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cartaNotas, setCartaNotas] = useState<Record<string, string>>({})
  const [cartaOverrides, setCartaOverrides] = useState<Record<string, Record<string, number>>>({})
  const [cartaActioning, setCartaActioning] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin?accion=cartas')
      const json = await res.json()
      if (res.ok) {
        setCartas((json.cartas as Record<string, unknown>[]) ?? [])
      } else {
        setError(`Error ${res.status}: ${json.error ?? 'desconocido'}`)
      }
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (active) cargar()
  }, [active, cargar])

  const pendientes = cartas.filter(c => !c.aprobado && !c.rechazado)
  const aprobadas = cartas.filter(c => c.aprobado)
  const rechazadas = cartas.filter(c => c.rechazado && !c.aprobado)

  const handleAction = async (pid: string, accion: 'aprobar' | 'rechazar') => {
    setCartaActioning(pid)
    const overrides = cartaOverrides[pid] ?? {}
    const body: Record<string, unknown> = {
      player_id: pid,
      accion,
      notas_admin: cartaNotas[pid] ?? null,
    }
    if (accion === 'aprobar' && Object.keys(overrides).length > 0) body.stat_overrides = overrides
    const res = await fetch('/api/carta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setCartaNotas(prev => { const n = { ...prev }; delete n[pid]; return n })
      setCartaOverrides(prev => { const n = { ...prev }; delete n[pid]; return n })
      await cargar()
    }
    setCartaActioning(null)
  }

  return (
    <div id="tab-cartas" className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
          FIFA CARTAS — {cartas.length} enviadas
        </div>
        <button onClick={cargar} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>↻ Refrescar</button>
      </div>

      {loading ? (
        <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Cargando...</div>
      ) : error ? (
        <div className="card" style={{ padding: 24, border: '1px solid var(--red)' }}>
          <p className="mono" style={{ fontSize: 12, color: 'var(--red)' }}>⚠ Error cargando cartas: {error}</p>
        </div>
      ) : cartas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ningún jugador ha enviado su evaluación aún.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* PENDIENTES */}
          {pendientes.length > 0 && (
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--amber)', marginBottom: 12 }}>
                ⏳ PENDIENTES ({pendientes.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pendientes.map(carta => {
                  const pid = carta.player_id as string
                  const profile = carta.profiles as { username: string; avatar_url: string | null } | null
                  const overrides = cartaOverrides[pid] ?? {}
                  return (
                    <div key={pid} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <PlayerAvatar url={profile?.avatar_url ?? null} username={profile?.username ?? '?'} size={40} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{profile?.username ?? pid}</div>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                            OVR {carta.ovr as number} · {String(carta.tier).toUpperCase()} · {(carta.posicion_carta as string | null) ?? '—'} · {(carta.pierna as string | null) ?? '—'}
                          </div>
                        </div>
                        <div style={{ marginLeft: 'auto' }}>
                          <span className="mono" style={{
                            fontSize: 22, fontWeight: 900, color:
                              (carta.ovr as number) >= 88 ? '#9f7aea' :
                              (carta.ovr as number) >= 81 ? '#f6993f' :
                              (carta.ovr as number) >= 74 ? '#f6c90e' :
                              (carta.ovr as number) >= 67 ? '#a0aec0' :
                              '#a0856b'
                          }}>
                            {carta.ovr as number}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                        {STATS.map(stat => {
                          const key = `stat_${stat}` as string
                          const original = carta[key] as number
                          const override = overrides[key]
                          const display = override ?? original
                          return (
                            <div key={stat} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>{stat.toUpperCase()}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: override ? 'var(--amber)' : 'var(--text)', minWidth: 28 }}>
                                  {display}
                                </span>
                                <input
                                  type="number" min={45} max={99} placeholder="—"
                                  value={override ?? ''}
                                  onChange={e => {
                                    const val = parseInt(e.target.value)
                                    setCartaOverrides(prev => {
                                      const next = { ...prev, [pid]: { ...prev[pid] } }
                                      if (isNaN(val)) { delete next[pid][key] } else { next[pid][key] = Math.min(99, Math.max(45, val)) }
                                      return next
                                    })
                                  }}
                                  style={{ width: 50, padding: '2px 6px', fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontFamily: 'monospace' }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {Object.keys(overrides).length > 0 && (
                        <div className="mono" style={{ fontSize: 10, color: 'var(--amber)' }}>
                          ⚠ Overrides activos — OVR se recalcula al aprobar
                        </div>
                      )}

                      <textarea
                        placeholder="Notas para el jugador (opcional)..."
                        value={cartaNotas[pid] ?? ''}
                        onChange={e => setCartaNotas(prev => ({ ...prev, [pid]: e.target.value }))}
                        rows={2}
                        style={{ width: '100%', padding: 10, fontSize: 13, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      />

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          disabled={cartaActioning === pid}
                          onClick={() => handleAction(pid, 'aprobar')}
                          className="btn btn-primary"
                          style={{ flex: 1, fontSize: 13 }}
                        >
                          {cartaActioning === pid ? '...' : '✓ Aprobar'}
                        </button>
                        <button
                          disabled={cartaActioning === pid}
                          onClick={() => handleAction(pid, 'rechazar')}
                          className="btn btn-danger"
                          style={{ flex: 1, fontSize: 13 }}
                        >
                          ✕ Rechazar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* APROBADAS */}
          {aprobadas.length > 0 && (
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--green)', marginBottom: 12 }}>
                ✓ APROBADAS ({aprobadas.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {aprobadas.map(carta => {
                  const pid = carta.player_id as string
                  const profile = carta.profiles as { username: string; avatar_url: string | null } | null
                  return (
                    <div key={pid} className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <PlayerAvatar url={profile?.avatar_url ?? null} username={profile?.username ?? '?'} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{profile?.username ?? pid}</div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          {STATS.map(s => `${s.toUpperCase()} ${carta[`stat_${s}` as keyof typeof carta] as number}`).join(' · ')}
                        </div>
                        {(carta.notas_admin as string | null) && (
                          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>📝 {carta.notas_admin as string}</div>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: 20, fontWeight: 900, color: 'var(--green)' }}>{carta.ovr as number}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{String(carta.tier).toUpperCase()}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* RECHAZADAS */}
          {rechazadas.length > 0 && (
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--red)', marginBottom: 12 }}>
                ✕ RECHAZADAS ({rechazadas.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rechazadas.map(carta => {
                  const pid = carta.player_id as string
                  const profile = carta.profiles as { username: string; avatar_url: string | null } | null
                  return (
                    <div key={pid} className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, opacity: 0.7 }}>
                      <PlayerAvatar url={profile?.avatar_url ?? null} username={profile?.username ?? '?'} size={32} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{profile?.username ?? pid}</div>
                        {(carta.notas_admin as string | null) && (
                          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>📝 {carta.notas_admin as string}</div>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--red)' }}>RECHAZADO</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { HistorialPartido } from '@/types/admin'

interface Props {
  active: boolean
}

async function adminAction(accion: string, extra: Record<string, unknown>): Promise<{ ok: boolean; mensaje?: string; error?: string }> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion, ...extra }),
  })
  return res.json()
}

export function TabHistorial({ active }: Props) {
  const supabase = createClient()
  const [historial, setHistorial] = useState<HistorialPartido[]>([])
  const [loading, setLoading] = useState(false)
  const [flash, setFlash] = useState('')

  // Per-partido expanded management panel
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Result form state
  const [golesA, setGolesA] = useState('')
  const [golesB, setGolesB] = useState('')
  const [ptsBlancos, setPtsBlancos] = useState('')
  const [ptsNegros, setPtsNegros] = useState('')
  const [ptsMorados, setPtsMorados] = useState('')
  const [savingResultado, setSavingResultado] = useState(false)
  const [savingConfirmar, setSavingConfirmar] = useState(false)
  const [savingEval, setSavingEval] = useState(false)

  const showFlash = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3500)
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    const hoy = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana, resultado, goles_a, goles_b, puntos_blanco, puntos_negro, puntos_morado, equipos_confirmados, evaluaciones_abiertas, cupos_total, tipo, inscripciones(estado), player_badges(badge_emoji, badge_nombre, profiles!player_badges_player_id_fkey(username))')
      .lt('fecha', hoy)
      .order('fecha', { ascending: false })
      .limit(30)
    setHistorial((data as unknown as HistorialPartido[]) ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (active) cargar()
  }, [active, cargar])

  const handleExpand = (id: string, p: HistorialPartido) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    // Pre-fill result form if score exists
    if (p.tipo === 'minitorneo') {
      setPtsBlancos(p.puntos_blanco != null ? String(p.puntos_blanco) : '')
      setPtsNegros(p.puntos_negro != null ? String(p.puntos_negro) : '')
      setPtsMorados(p.puntos_morado != null ? String(p.puntos_morado) : '')
    } else {
      setGolesA(p.goles_a != null ? String(p.goles_a) : '')
      setGolesB(p.goles_b != null ? String(p.goles_b) : '')
    }
  }

  const handleConfirmar = async (partido_id: string) => {
    setSavingConfirmar(true)
    const r = await adminAction('confirmar_partido', { partido_id })
    if (r.ok) {
      setHistorial(prev => prev.map(p => p.id === partido_id ? { ...p, equipos_confirmados: true } : p))
      showFlash('Partido confirmado ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingConfirmar(false)
  }

  const handleResultado = async (p: HistorialPartido) => {
    setSavingResultado(true)
    let r
    if (p.tipo === 'minitorneo') {
      r = await adminAction('registrar_resultado', {
        partido_id: p.id,
        puntos_blanco: parseInt(ptsBlancos) || 0,
        puntos_negro: parseInt(ptsNegros) || 0,
        puntos_morado: parseInt(ptsMorados) || 0,
      })
    } else {
      r = await adminAction('registrar_resultado', {
        partido_id: p.id,
        goles_a: parseInt(golesA) || 0,
        goles_b: parseInt(golesB) || 0,
      })
    }
    if (r.ok) {
      await cargar()
      showFlash(r.mensaje ?? 'Resultado guardado ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingResultado(false)
  }

  const handleAbrirEval = async (partido_id: string) => {
    setSavingEval(true)
    const r = await adminAction('abrir_evaluaciones', { partido_id })
    if (r.ok) {
      setHistorial(prev => prev.map(p => p.id === partido_id ? { ...p, evaluaciones_abiertas: true } : p))
      showFlash(r.mensaje ?? 'Evaluaciones abiertas ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingEval(false)
  }

  return (
    <div id="tab-historial" className="fade-in">
      {flash && (
        <div className="mono" style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#0f2d1a', border: '1px solid #16a34a', color: 'var(--green)',
          padding: '10px 20px', borderRadius: 3, fontSize: 13, zIndex: 200,
        }}>
          {flash}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
          HISTORIAL — {historial.length} partidos pasados
        </div>
        <button onClick={cargar} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>↻ Refrescar</button>
      </div>

      {loading ? (
        <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Cargando...</div>
      ) : historial.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>No hay partidos pasados registrados.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {historial.map(p => {
            const confirmados = (p.inscripciones ?? []).filter((i: { estado: string }) => i.estado === 'confirmado').length
            const badges = p.player_badges ?? []
            const esMinitorneo = p.tipo === 'minitorneo'
            const score = esMinitorneo
              ? (p.puntos_blanco != null ? `B${p.puntos_blanco}·N${p.puntos_negro}·M${p.puntos_morado}` : null)
              : (p.goles_a != null && p.goles_b != null ? `${p.goles_a} – ${p.goles_b}` : p.resultado ?? null)
            const isExpanded = expandedId === p.id

            return (
              <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Header row — click to expand */}
                <button
                  onClick={() => handleExpand(p.id, p)}
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '16px 20px', textAlign: 'left',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
                  }}
                >
                  <div>
                    <div className="display" style={{ fontSize: 20, letterSpacing: '0.05em' }}>
                      {p.dia_semana.toUpperCase()}
                      {esMinitorneo && <span style={{ fontSize: 12, marginLeft: 6, verticalAlign: 'middle' }}>🟣</span>}
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
                        {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{confirmados} jugadores</span>
                      {score
                        ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>🤍 {score} 🖤</span>
                        : <span style={{ color: 'var(--amber)' }}>sin resultado</span>
                      }
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    {p.equipos_confirmados && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--green)', border: '1px solid #16a34a', padding: '2px 8px', borderRadius: 2 }}>
                        JUGADO
                      </span>
                    )}
                    {p.evaluaciones_abiertas && (
                      <span className="mono" style={{ fontSize: 10, color: '#a78bfa', border: '1px solid #7c3aed', padding: '2px 8px', borderRadius: 2 }}>
                        EVAL ✓
                      </span>
                    )}
                    <span className="mono" style={{ fontSize: 14, color: 'var(--text-dim)' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Badges */}
                {badges.length > 0 && (
                  <div style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: isExpanded ? 0 : 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {badges.map((b, i) => (
                      <div key={i} className="mono" style={{ fontSize: 11, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 2, padding: '3px 8px' }}>
                        {b.badge_emoji} {b.badge_nombre}
                        {b.profiles && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>· {b.profiles.username}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Expandable management panel */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* ── Confirm match happened ── */}
                    {!p.equipos_confirmados && (
                      <div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 8 }}>CONFIRMAR PARTIDO</div>
                        <button
                          onClick={() => handleConfirmar(p.id)}
                          disabled={savingConfirmar}
                          className="btn btn-primary"
                          style={{ padding: '9px 20px', fontSize: 13 }}
                        >
                          {savingConfirmar ? '...' : '✓ Marcar como jugado'}
                        </button>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                          Necesario para que el cron abra evaluaciones automáticamente al día siguiente.
                        </div>
                      </div>
                    )}

                    {/* ── Score entry ── */}
                    <div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 10 }}>
                        {score ? 'EDITAR RESULTADO' : 'REGISTRAR RESULTADO'}
                      </div>
                      {esMinitorneo ? (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                          {([
                            { label: '⬜ Blancos', val: ptsBlancos, set: setPtsBlancos },
                            { label: '⬛ Negros', val: ptsNegros, set: setPtsNegros },
                            { label: '🟣 Morados', val: ptsMorados, set: setPtsMorados },
                          ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                            <div key={label}>
                              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
                              <input
                                type="number" min="0" max="99" value={val}
                                onChange={e => set(e.target.value)}
                                style={{ width: 72, padding: '8px 10px', textAlign: 'center', fontSize: 18, fontWeight: 700 }}
                              />
                            </div>
                          ))}
                          <button
                            onClick={() => handleResultado(p)}
                            disabled={savingResultado}
                            className="btn btn-primary"
                            style={{ padding: '9px 18px' }}
                          >
                            {savingResultado ? '...' : 'Guardar'}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>🤍 Blancos</div>
                            <input
                              type="number" min="0" max="99" value={golesA}
                              onChange={e => setGolesA(e.target.value)}
                              style={{ width: 72, padding: '8px 10px', textAlign: 'center', fontSize: 22, fontWeight: 700 }}
                            />
                          </div>
                          <div className="mono" style={{ fontSize: 20, color: 'var(--text-dim)', paddingBottom: 8 }}>–</div>
                          <div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>🖤 Negros</div>
                            <input
                              type="number" min="0" max="99" value={golesB}
                              onChange={e => setGolesB(e.target.value)}
                              style={{ width: 72, padding: '8px 10px', textAlign: 'center', fontSize: 22, fontWeight: 700 }}
                            />
                          </div>
                          <button
                            onClick={() => handleResultado(p)}
                            disabled={savingResultado}
                            className="btn btn-primary"
                            style={{ padding: '9px 18px' }}
                          >
                            {savingResultado ? '...' : 'Guardar'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ── Open evaluations ── */}
                    <div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 8 }}>EVALUACIONES</div>
                      {p.evaluaciones_abiertas ? (
                        <div className="mono" style={{ fontSize: 12, color: '#a78bfa' }}>📊 Evaluaciones ya están abiertas.</div>
                      ) : (
                        <button
                          onClick={() => handleAbrirEval(p.id)}
                          disabled={savingEval}
                          className="btn btn-ghost"
                          style={{ fontSize: 12, padding: '8px 16px', color: '#a78bfa', borderColor: '#7c3aed' }}
                        >
                          {savingEval ? '...' : '📊 Abrir evaluaciones ahora'}
                        </button>
                      )}
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                        Notifica por push a jugadores confirmados para que evalúen.
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

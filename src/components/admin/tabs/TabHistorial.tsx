'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { HistorialPartido } from '@/types/admin'

interface Props {
  active: boolean
}

export function TabHistorial({ active }: Props) {
  const supabase = createClient()
  const [historial, setHistorial] = useState<HistorialPartido[]>([])
  const [loading, setLoading] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const hoy = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana, resultado, goles_a, goles_b, equipos_confirmados, cupos_total, tipo, inscripciones(estado), player_badges(badge_emoji, badge_nombre, profiles!player_badges_player_id_fkey(username))')
      .lt('fecha', hoy)
      .order('fecha', { ascending: false })
      .limit(30)
    setHistorial((data as unknown as HistorialPartido[]) ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (active) cargar()
  }, [active, cargar])

  return (
    <div id="tab-historial" className="fade-in">
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {historial.map(p => {
            const confirmados = (p.inscripciones ?? []).filter((i: { estado: string }) => i.estado === 'confirmado').length
            const badges = p.player_badges ?? []
            const score = p.goles_a != null && p.goles_b != null
              ? `${p.goles_a} – ${p.goles_b}`
              : p.resultado ?? null
            return (
              <div key={p.id} className="card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div className="display" style={{ fontSize: 20, letterSpacing: '0.05em' }}>
                      {p.dia_semana.toUpperCase()}
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
                        {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {confirmados} jugadores
                      {score && <span style={{ color: 'var(--text)', fontWeight: 600, marginLeft: 12 }}>🤍 {score} 🖤</span>}
                      {!score && <span style={{ color: 'var(--text-dim)', marginLeft: 12 }}>sin resultado</span>}
                    </div>
                  </div>
                  {p.equipos_confirmados && (
                    <div className="mono" style={{ fontSize: 10, color: 'var(--green)', border: '1px solid #16a34a', padding: '2px 8px', borderRadius: 2 }}>
                      CONFIRMADO
                    </div>
                  )}
                </div>
                {badges.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {badges.map((b, i) => (
                      <div key={i} className="mono" style={{ fontSize: 11, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 2, padding: '3px 8px' }}>
                        {b.badge_emoji} {b.badge_nombre}
                        {b.profiles && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>· {b.profiles.username}</span>}
                      </div>
                    ))}
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

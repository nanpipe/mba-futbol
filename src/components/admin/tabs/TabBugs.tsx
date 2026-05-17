'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type BugEstado = 'nuevo' | 'revisado' | 'cerrado'

interface BugReport {
  id: string
  username: string | null
  descripcion: string
  screenshot_url: string | null
  estado: BugEstado
  created_at: string
}

const ESTADO_LABEL: Record<BugEstado, string> = {
  nuevo: 'Nuevo',
  revisado: 'Revisado',
  cerrado: 'Cerrado',
}

const ESTADO_COLOR: Record<BugEstado, string> = {
  nuevo: 'var(--amber)',
  revisado: '#818cf8',
  cerrado: 'var(--text-muted)',
}

const ESTADO_BG: Record<BugEstado, string> = {
  nuevo: '#1a1500',
  revisado: '#0d0d1a',
  cerrado: 'var(--bg-card)',
}

const ESTADOS: BugEstado[] = ['nuevo', 'revisado', 'cerrado']

interface TabBugsProps {
  active?: boolean
}

export function TabBugs({ active }: TabBugsProps) {
  const supabase = createClient()
  const [bugs, setBugs] = useState<BugReport[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<BugEstado | 'todos'>('todos')

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('bug_reports')
      .select('id, username, descripcion, screenshot_url, estado, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    setBugs((data ?? []) as BugReport[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (active) cargar()
  }, [active, cargar])

  const cambiarEstado = async (id: string, nuevoEstado: BugEstado) => {
    setUpdatingId(id)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'actualizar_bug_report', bug_id: id, estado: nuevoEstado }),
    })
    if (res.ok) {
      setBugs(prev => prev.map(b => b.id === id ? { ...b, estado: nuevoEstado } : b))
    }
    setUpdatingId(null)
  }

  const bugsVisibles = filtro === 'todos' ? bugs : bugs.filter(b => b.estado === filtro)
  const counts = bugs.reduce((acc, b) => { acc[b.estado] = (acc[b.estado] ?? 0) + 1; return acc }, {} as Record<BugEstado, number>)

  if (loading) return (
    <div className="mono pulsing" style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
      CARGANDO...
    </div>
  )

  return (
    <div>
      {/* Header + filtros */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
          🐛 BUG REPORTS — {bugs.length} TOTAL
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['todos', ...ESTADOS] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className="mono"
              style={{
                padding: '5px 12px', borderRadius: 3, border: '1px solid',
                background: filtro === f ? 'var(--bg-card)' : 'none',
                borderColor: filtro === f ? 'var(--border)' : 'transparent',
                cursor: 'pointer', fontSize: 11, letterSpacing: '0.08em',
                color: filtro === f
                  ? (f === 'todos' ? 'var(--text)' : ESTADO_COLOR[f])
                  : 'var(--text-muted)',
              }}
            >
              {f === 'todos' ? 'Todos' : ESTADO_LABEL[f]}
              {f !== 'todos' && counts[f] ? ` (${counts[f]})` : ''}
              {f === 'todos' ? ` (${bugs.length})` : ''}
            </button>
          ))}
        </div>
      </div>

      {bugsVisibles.length === 0 && (
        <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '48px 0' }}>
          No hay reportes{filtro !== 'todos' ? ` con estado "${ESTADO_LABEL[filtro]}"` : ''}.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bugsVisibles.map(bug => {
          const isExpanded = expandedId === bug.id
          const fecha = new Date(bug.created_at).toLocaleDateString('es-CO', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })

          return (
            <div
              key={bug.id}
              style={{
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${ESTADO_COLOR[bug.estado]}`,
                borderRadius: 4,
                background: isExpanded ? ESTADO_BG[bug.estado] : 'var(--bg-card)',
                overflow: 'hidden',
                transition: 'background 0.15s',
              }}
            >
              {/* Card header */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : bug.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', cursor: 'pointer',
                  flexWrap: 'wrap',
                }}
              >
                <span className="mono" style={{ fontSize: 12, color: ESTADO_COLOR[bug.estado], minWidth: 68 }}>
                  {ESTADO_LABEL[bug.estado].toUpperCase()}
                </span>
                <span style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {bug.descripcion.slice(0, 80)}{bug.descripcion.length > 80 ? '…' : ''}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  {bug.screenshot_url && (
                    <span style={{ fontSize: 14 }} title="Tiene captura">📎</span>
                  )}
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {bug.username ?? '?'} · {fecha}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                    ▾
                  </span>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 16px 20px' }}>
                  {/* Description */}
                  <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
                    DESCRIPCIÓN
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)', whiteSpace: 'pre-wrap', marginBottom: 20 }}>
                    {bug.descripcion}
                  </p>

                  {/* Screenshot */}
                  {bug.screenshot_url && (
                    <div style={{ marginBottom: 20 }}>
                      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
                        CAPTURA
                      </div>
                      <a href={bug.screenshot_url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={bug.screenshot_url}
                          alt="captura"
                          style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border)' }}
                        />
                      </a>
                    </div>
                  )}

                  {/* Estado selector */}
                  <div>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 10 }}>
                      ESTADO
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {ESTADOS.map(e => (
                        <button
                          key={e}
                          disabled={updatingId === bug.id}
                          onClick={() => cambiarEstado(bug.id, e)}
                          className="mono"
                          style={{
                            padding: '7px 16px', borderRadius: 3, cursor: 'pointer',
                            fontSize: 11, letterSpacing: '0.08em',
                            border: `1px solid ${bug.estado === e ? ESTADO_COLOR[e] : 'var(--border)'}`,
                            background: bug.estado === e ? ESTADO_BG[e] : 'none',
                            color: bug.estado === e ? ESTADO_COLOR[e] : 'var(--text-muted)',
                            opacity: updatingId === bug.id ? 0.5 : 1,
                            transition: 'all 0.15s',
                          }}
                        >
                          {ESTADO_LABEL[e]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

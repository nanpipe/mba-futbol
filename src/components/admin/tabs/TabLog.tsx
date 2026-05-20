'use client'

import { useState } from 'react'
import type { ActivityLog } from '@/types/admin'
import { useFetchAdmin } from '@/hooks/useFetchAdmin'
import { SectionHeader } from '@/components/SectionHeader'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { ErrorAlert } from '@/components/ErrorAlert'

const LOG_FILTERS = [
  { id: 'todos',        label: 'Todos' },
  { id: 'login',        label: 'Login',         match: ['login', 'registro', 'recuperar'] as const },
  { id: 'inscripcion',  label: 'Inscripción',   match: ['inscripcion', 'baja_partido', 'invitado', 'bumped_espera', 'agregar_jugador_partido'] as const },
  { id: 'carta',        label: 'Carta',         match: ['enviar_carta', 'aprobar_carta', 'rechazar_carta'] as const },
  { id: 'partido',      label: 'Partido',       match: ['crear_partido', 'editar_partido', 'eliminar_partido', 'registrar_resultado', 'forzar_notif_apertura', 'abrir_evaluaciones', 'guardar_equipos', 'confirmar_equipos', 'resetear_equipos'] as const },
  { id: 'jugador',      label: 'Jugador',       match: ['aprobar_jugador', 'rechazar_jugador', 'banear', 'liberar_ban', 'eliminar_jugador', 'editar_jugador', 'cambiar_password', 'actualizar_posicion', 'toggle_uniform', 'mover_espera', 'remover_partido', 'promover_espera_manual'] as const },
  { id: 'perfil',       label: 'Perfil',        match: ['actualizar_perfil', 'subir_avatar'] as const },
  { id: 'notif',        label: 'Notif',         match: ['cron_notificaciones', 'guardar_setting', 'enviar_email_prueba', 'notif_', 'push_'] as const },
] as const

type FilterId = typeof LOG_FILTERS[number]['id']

interface Props {
  active: boolean
}

export function TabLog({ active }: Props) {
  const { data: logs, loading, error, reload } = useFetchAdmin<ActivityLog>('logs', { active, key: 'logs' })
  const [logFilter, setLogFilter] = useState<FilterId>('todos')
  const [logSearch, setLogSearch] = useState('')

  const filteredLogs = logs.filter(log => {
    const matchesFilter = logFilter === 'todos' ||
      (LOG_FILTERS.find(f => f.id === logFilter) as { match?: readonly string[] } | undefined)?.match?.some(m => log.accion.includes(m))
    const matchesSearch = !logSearch ||
      log.username?.toLowerCase().includes(logSearch.toLowerCase()) ||
      log.accion.toLowerCase().includes(logSearch.toLowerCase())
    return matchesFilter && matchesSearch
  })

  return (
    <div id="tab-log" className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <SectionHeader
          title={`ACTIVIDAD${logFilter !== 'todos' ? ` — ${filteredLogs.length} de ${logs.length}` : ''}`}
          count={logFilter === 'todos' ? filteredLogs.length : null}
        />
        <button onClick={reload} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>
          ↻ Refrescar
        </button>
      </div>

      <input
        type="text"
        placeholder="Buscar por usuario o acción..."
        value={logSearch}
        onChange={e => setLogSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {LOG_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setLogFilter(f.id)}
            className="mono"
            style={{
              fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
              background: logFilter === f.id ? 'var(--green)' : 'var(--bg-card)',
              color: logFilter === f.id ? '#000' : 'var(--text-muted)',
              border: `1px solid ${logFilter === f.id ? 'var(--green)' : 'var(--border)'}`,
              letterSpacing: '0.06em',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorAlert message={error} />
      ) : loading ? (
        <LoadingSpinner />
      ) : filteredLogs.length === 0 ? (
        <Card padding={48} style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin registros.</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredLogs.map(log => (
            <Card key={log.id} padding="14px 16px">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  {new Date(log.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'America/Bogota' })}
                  {' '}
                  {new Date(log.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>
                  {log.username ?? '—'}
                </span>
                {log.ip && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                    {log.ip}
                  </span>
                )}
              </div>
              <div style={{ marginBottom: log.detalles && Object.keys(log.detalles).length > 0 ? 8 : 0 }}>
                <span className="mono" style={{
                  fontSize: 12, letterSpacing: '0.06em', color: 'var(--text)',
                  background: 'var(--bg)', padding: '3px 8px', borderRadius: 3, border: '1px solid var(--border)',
                }}>
                  {log.accion}
                </span>
              </div>
              {log.detalles && Object.keys(log.detalles).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                  {Object.entries(log.detalles)
                    .filter(([k]) => !['player_id', 'partido_id'].includes(k))
                    .map(([k, v]) => (
                      <span key={k} className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--text-dim)' }}>{k}:</span> {String(v)}
                      </span>
                    ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

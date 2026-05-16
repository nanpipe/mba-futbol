'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Partido, Player } from '@/types/admin'

const AUTO_NOTIFS = [
  '🙋 Nuevo jugador solicita acceso → Admins',
  '⚠️ Jugador se retira del partido → Admins',
  '✅ Jugador promovido de lista de espera → ese jugador (email + push)',
  '📋 Partido abierto para inscripciones → todos los jugadores',
  '⏰ Recordatorio antes del partido → confirmados',
  '🔔 Cupo disponible → lista de espera',
  '🎭 Tu invitado entró al partido → invitador',
  '⚽ Equipos confirmados → cada confirmado (su equipo)',
  '📊 Evaluaciones abiertas → confirmados',
]

const DIAGNOSTICO = [
  'El jugador tiene que haber tocado "🔔 Notificaciones" y aceptado el permiso',
  'En iOS, la app debe estar agregada al Home Screen primero',
  'La tabla push_subscriptions debe existir en Supabase',
  'NEXT_PUBLIC_PUSHER_APP_KEY y PUSHER_APP_SECRET deben estar configurados',
]

type PushGroup = 'todos' | 'admins' | 'confirmados' | 'espera' | 'todos_partido' | 'individual'

const GRUPOS: { id: PushGroup; label: string }[] = [
  { id: 'todos',         label: '🌐 Todos' },
  { id: 'admins',        label: '🛡️ Admins' },
  { id: 'confirmados',   label: '✅ Confirmados' },
  { id: 'espera',        label: '⏳ Lista de espera' },
  { id: 'todos_partido', label: '⚽ Todos del partido' },
  { id: 'individual',    label: '👤 Individual' },
]

interface Props {
  partidos: Partido[]
  players: Player[]
  onFlash: (msg: string) => void
}

export function TabNotifs({ partidos, players, onFlash }: Props) {
  const supabase = createClient()
  const [pushTitle, setPushTitle] = useState('MBA FC')
  const [pushBody, setPushBody] = useState('¡Hay cupo en el partido! Entra a inscribirte ⚽')
  const [pushTarget, setPushTarget] = useState('')
  const [pushGroup, setPushGroup] = useState<PushGroup>('todos')
  const [pushPartidoId, setPushPartidoId] = useState('')
  const [pushSending, setPushSending] = useState(false)

  const enviarPush = async () => {
    setPushSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    const payload: Record<string, unknown> = { title: pushTitle, body: pushBody }
    if (pushGroup === 'individual') {
      payload.player_id = pushTarget || undefined
    } else if (pushGroup !== 'todos') {
      payload.group = pushGroup
      if (['confirmados', 'espera', 'todos_partido'].includes(pushGroup)) {
        payload.partido_id = pushPartidoId || partidos[0]?.id
      }
    }
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    onFlash(data.mensaje ?? data.error ?? 'Error desconocido')
    setPushSending(false)
  }

  return (
    <div id="tab-notifs" className="fade-in" style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 24 }}>
          ENVIAR NOTIFICACIÓN
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Grupo */}
          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 10 }}>DESTINATARIOS</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GRUPOS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setPushGroup(g.id)}
                  className="btn"
                  style={{
                    fontSize: 11, padding: '6px 12px',
                    background: pushGroup === g.id ? 'var(--green)' : 'var(--bg-card)',
                    color: pushGroup === g.id ? '#000' : 'var(--text-muted)',
                    border: `1px solid ${pushGroup === g.id ? 'var(--green)' : 'var(--border)'}`,
                    fontFamily: 'DM Mono, monospace',
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Partido selector */}
          {['confirmados', 'espera', 'todos_partido'].includes(pushGroup) && (
            <div>
              <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>PARTIDO</label>
              <select
                value={pushPartidoId || partidos[0]?.id || ''}
                onChange={e => setPushPartidoId(e.target.value)}
                style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}
              >
                {partidos.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.dia_semana} {new Date(p.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Individual player */}
          {pushGroup === 'individual' && (
            <div>
              <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>JUGADOR</label>
              <select
                value={pushTarget}
                onChange={e => setPushTarget(e.target.value)}
                style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}
              >
                <option value="">— Seleccionar jugador —</option>
                {players.filter(p => p.aprobado && !p.baneado).map(p => (
                  <option key={p.id} value={p.id}>{p.username}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>TÍTULO</label>
            <input type="text" value={pushTitle} onChange={e => setPushTitle(e.target.value)} />
          </div>
          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>MENSAJE</label>
            <input type="text" value={pushBody} onChange={e => setPushBody(e.target.value)} />
          </div>

          <button
            onClick={enviarPush}
            disabled={pushSending || (pushGroup === 'individual' && !pushTarget)}
            className="btn btn-primary"
            style={{ padding: '14px', fontSize: 13 }}
          >
            {pushSending ? 'Enviando...' : 'Enviar notificación'}
          </button>
        </div>

        {/* Auto-notifs info */}
        <div className="card" style={{ marginTop: 32, borderColor: '#1a2a1a' }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 12 }}>NOTIFICACIONES AUTOMÁTICAS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {AUTO_NOTIFS.map((item, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item}</div>
            ))}
          </div>
        </div>

        {/* Diagnóstico */}
        <div className="card" style={{ marginTop: 16, borderColor: '#1a2a1a' }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 12 }}>DIAGNÓSTICO</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--green)' }}>·</span>{' '}
              Emails (Resend): ver entregas, rebotes y aperturas en{' '}
              <a href="https://resend.com/emails" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', textDecoration: 'underline' }}>resend.com/emails</a>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--green)' }}>·</span>{' '}
              Push y emails: cada envío queda registrado en el LOG de actividad
            </div>
            {DIAGNOSTICO.map((item, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--green)' }}>·</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

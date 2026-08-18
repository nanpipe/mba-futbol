'use client'

import { useState, useEffect, useCallback } from 'react'

export interface InvitadoPartido {
  id: string
  nombre: string
  estado: string
  player_id?: string
}

export interface InvitadoGuardado {
  id: string
  nombre: string
  email: string | null
}

/**
 * The "mis invitados" block on the home screen: current guests for this match
 * plus a form to add one. Email is optional and exists only so the guest can be
 * told directly when they get a spot. Saved guests can be added in one tap.
 */
export function MisInvitados({
  partidoId,
  misInvitados,
  invitadosEspera,
  maxInvitados,
  horaPromo,
  onChanged,
}: {
  partidoId: string
  misInvitados: InvitadoPartido[]
  invitadosEspera: InvitadoPartido[]
  maxInvitados: number
  horaPromo: string
  onChanged: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [guardar, setGuardar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [guardados, setGuardados] = useState<InvitadoGuardado[]>([])

  const cargarGuardados = useCallback(async () => {
    try {
      const res = await fetch('/api/invitados-guardados')
      if (!res.ok) return
      const data = await res.json()
      setGuardados(data.invitados ?? [])
    } catch { /* the picker is a convenience — never block adding a guest */ }
  }, [])

  useEffect(() => { cargarGuardados() }, [cargarGuardados])

  const yaInvitado = (n: string) =>
    misInvitados.some(i => i.nombre.toLowerCase() === n.trim().toLowerCase())

  const agregar = async (n: string, e: string | null, recordar: boolean) => {
    if (!n.trim()) return
    setEnviando(true)
    setError('')
    const res = await fetch('/api/invitados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id: partidoId, nombre: n.trim(), email: e || undefined, guardar: recordar }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Error agregando invitado')
    } else {
      setNombre('')
      setEmail('')
      setGuardar(false)
      if (recordar) cargarGuardados()
      onChanged()
    }
    setEnviando(false)
  }

  const eliminar = async (invitado_id: string) => {
    await fetch('/api/invitados', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitado_id }),
    })
    onChanged()
  }

  const lleno = misInvitados.length >= maxInvitados
  const disponibles = guardados.filter(g => !yaInvitado(g.nombre))

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
          MIS INVITADOS ({misInvitados.length}/{maxInvitados})
        </div>
      </div>

      {misInvitados.map(inv => (
        <div key={inv.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 3,
          border: '1px solid #1a2a3a', marginBottom: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span className={inv.estado === 'confirmado' ? 'badge badge-green' : 'badge badge-amber'}>
              {inv.estado === 'confirmado' ? '✓' : 'ESPERA #' + (invitadosEspera.findIndex(i => i.id === inv.id) + 1)}
            </span>
            <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inv.nombre}
            </span>
          </div>
          <button
            onClick={() => eliminar(inv.id)}
            className="mono"
            aria-label={'Quitar ' + inv.nombre}
            style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      ))}

      {!lleno && (
        <>
          {/* One-tap add from the player's saved guests */}
          {disponibles.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 6 }}>
                GUARDADOS
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {disponibles.map(g => (
                  <button
                    key={g.id}
                    onClick={() => agregar(g.nombre, g.email, false)}
                    disabled={enviando}
                    className="mono"
                    title={g.email ?? 'Sin correo'}
                    style={{
                      fontSize: 11, padding: '6px 11px', borderRadius: 999, cursor: 'pointer',
                      background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)',
                    }}
                  >
                    + {g.nombre}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={nombre}
                onChange={e => { setNombre(e.target.value); setError('') }}
                placeholder="Nombre del invitado"
                maxLength={80}
                style={{ flex: 1 }}
              />
              <button
                onClick={() => agregar(nombre, email, guardar)}
                disabled={enviando || !nombre.trim()}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '8px 14px', whiteSpace: 'nowrap' }}
              >
                {enviando ? '...' : '+ Agregar'}
              </button>
            </div>

            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              placeholder="Correo del invitado (opcional)"
              maxLength={120}
              onKeyDown={e => e.key === 'Enter' && agregar(nombre, email, guardar)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />

            <label className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}>
              <input type="checkbox" checked={guardar} onChange={e => setGuardar(e.target.checked)} style={{ cursor: 'pointer' }} />
              Guardar para próximos partidos
            </label>
          </div>

          {error && (
            <div className="mono" style={{
              fontSize: 12, marginTop: 8, padding: '8px 12px', borderRadius: 3,
              color: 'var(--red)', background: '#2d0a0a', border: '1px solid #7f1d1d',
            }}>
              {error}
            </div>
          )}
        </>
      )}

      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.6 }}>
        Los invitados están en lista de espera. Si quedan cupos a las {horaPromo} del día del partido, entran
        automáticamente. Si dejas su correo, le avisamos a él directamente.
      </div>
    </div>
  )
}

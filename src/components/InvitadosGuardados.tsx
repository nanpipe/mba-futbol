'use client'

import { useState, useEffect, useCallback } from 'react'
import type { InvitadoGuardado } from '@/components/MisInvitados'

const EMPTY = { nombre: '', email: '' }

/**
 * The player's saved-guest address book: create, edit and delete regulars so
 * they don't retype them every match. Name + email only; email is optional and
 * used to notify the guest directly when they get a spot.
 */
export function InvitadosGuardados() {
  const [lista, setLista] = useState<InvitadoGuardado[]>([])
  const [cargando, setCargando] = useState(true)
  const [nuevo, setNuevo] = useState(EMPTY)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState(EMPTY)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch('/api/invitados-guardados')
      if (res.ok) {
        const data = await res.json()
        setLista(data.invitados ?? [])
      }
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const enviar = async (method: 'POST' | 'PATCH' | 'DELETE', body: object) => {
    setOcupado(true)
    setError('')
    const res = await fetch('/api/invitados-guardados', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setOcupado(false)
    if (!res.ok) {
      setError(data.error ?? 'Error guardando')
      return false
    }
    await cargar()
    return true
  }

  const crear = async () => {
    if (!nuevo.nombre.trim()) return
    if (await enviar('POST', { nombre: nuevo.nombre.trim(), email: nuevo.email.trim() || undefined })) {
      setNuevo(EMPTY)
    }
  }

  const guardarEdicion = async () => {
    if (!editId || !edit.nombre.trim()) return
    if (await enviar('PATCH', { id: editId, nombre: edit.nombre.trim(), email: edit.email.trim() || undefined })) {
      setEditId(null)
    }
  }

  const eliminar = async (inv: InvitadoGuardado) => {
    if (!confirm(`¿Eliminar a ${inv.nombre} de tus invitados guardados?`)) return
    await enviar('DELETE', { id: inv.id })
  }

  const empezarEdicion = (inv: InvitadoGuardado) => {
    setError('')
    setEditId(inv.id)
    setEdit({ nombre: inv.nombre, email: inv.email ?? '' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        Tus invitados frecuentes. Al agregar invitados a un partido los eliges con un toque.
        El correo es opcional — si lo pones, le avisamos a él cuando entre.
      </div>

      {cargando ? (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Aún no has guardado invitados.
        </div>
      ) : (
        lista.map(inv => (
          <div key={inv.id} style={{
            padding: '10px 12px', background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 6,
          }}>
            {editId === inv.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="text"
                  value={edit.nombre}
                  onChange={e => setEdit(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Nombre"
                  maxLength={80}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                <input
                  type="email"
                  value={edit.email}
                  onChange={e => setEdit(p => ({ ...p, email: e.target.value }))}
                  placeholder="Correo (opcional)"
                  maxLength={120}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={guardarEdicion} disabled={ocupado || !edit.nombre.trim()} className="btn btn-primary" style={{ fontSize: 12, padding: '8px 16px' }}>
                    Guardar
                  </button>
                  <button onClick={() => { setEditId(null); setError('') }} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 16px' }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.nombre}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.email ?? 'sin correo'}
                  </div>
                </div>
                <button
                  onClick={() => empezarEdicion(inv)}
                  className="mono"
                  style={{ fontSize: 11, padding: '5px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                >
                  Editar
                </button>
                <button
                  onClick={() => eliminar(inv)}
                  aria-label={'Eliminar ' + inv.nombre}
                  className="mono"
                  style={{ fontSize: 13, padding: '5px 9px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--red)', cursor: 'pointer', flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {/* Add new */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <input
          type="text"
          value={nuevo.nombre}
          onChange={e => { setNuevo(p => ({ ...p, nombre: e.target.value })); setError('') }}
          placeholder="Nombre del invitado"
          maxLength={80}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        <input
          type="email"
          value={nuevo.email}
          onChange={e => { setNuevo(p => ({ ...p, email: e.target.value })); setError('') }}
          placeholder="Correo (opcional)"
          maxLength={120}
          onKeyDown={e => e.key === 'Enter' && crear()}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        <button onClick={crear} disabled={ocupado || !nuevo.nombre.trim()} className="btn btn-ghost" style={{ fontSize: 12, padding: '9px 16px' }}>
          + Guardar invitado
        </button>
      </div>

      {error && (
        <div className="mono" style={{
          fontSize: 12, padding: '8px 12px', borderRadius: 3,
          color: 'var(--red)', background: '#2d0a0a', border: '1px solid #7f1d1d',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}

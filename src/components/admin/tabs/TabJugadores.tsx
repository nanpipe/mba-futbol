'use client'

import { useState } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SectionHeader } from '@/components/SectionHeader'
import { FormLabel } from '@/components/FormLabel'
import { ButtonGroup } from '@/components/ButtonGroup'
import { Card } from '@/components/Card'
import { ModalOverlay } from '@/components/ModalOverlay'
import type { Player, AdminAction } from '@/types/admin'

interface Props {
  players: Player[]
  playerIdsWithPush: Set<string>
  accionAdmin: AdminAction
  isSuperAdmin: boolean
  usarUniforme?: boolean
}

export function TabJugadores({ players, playerIdsWithPush, accionAdmin, isSuperAdmin, usarUniforme = true }: Props) {
  const [editModal, setEditModal] = useState<Player | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editSuspenderOpen, setEditSuspenderOpen] = useState(false)
  const [editBanRazon, setEditBanRazon] = useState('')
  const [editBanFecha, setEditBanFecha] = useState('')
  const [editDeleteOpen, setEditDeleteOpen] = useState(false)
  const [editDeleteConfirm, setEditDeleteConfirm] = useState('')

  const isPrivileged = (role: string) => role === 'admin' || role === 'superadmin'
  const roleOrder = (role: string) => role === 'superadmin' ? 0 : role === 'admin' ? 1 : 2

  const baneados = players.filter(p => p.baneado && !isPrivileged(p.role))
  const activos = players
    .filter(p => p.aprobado && !p.baneado)
    .sort((a, b) => {
      const ro = roleOrder(a.role) - roleOrder(b.role)
      if (ro !== 0) return ro
      return a.username.localeCompare(b.username)
    })

  const abrirEdit = (p: Player) => {
    setEditModal(p)
    setEditEmail(p.email)
    setEditPassword('')
    setEditSuspenderOpen(false)
    setEditBanRazon('')
    setEditBanFecha('')
    setEditDeleteOpen(false)
    setEditDeleteConfirm('')
  }

  const cerrarEdit = () => {
    setEditModal(null)
    setEditPassword('')
    setEditSuspenderOpen(false)
    setEditBanRazon('')
    setEditBanFecha('')
    setEditDeleteOpen(false)
    setEditDeleteConfirm('')
  }

  const confirmarEdit = async () => {
    if (!editModal) return
    if (isSuperAdmin) {
      await accionAdmin('editar_jugador', { player_id: editModal.id, email: editEmail })
      if (editPassword.trim().length >= 6) {
        await accionAdmin('cambiar_password', { player_id: editModal.id, password: editPassword.trim() })
      }
    }
    cerrarEdit()
  }

  const confirmarSuspender = async () => {
    if (!editModal) return
    const ok = await accionAdmin('banear', {
      player_id: editModal.id,
      razon: editBanRazon || 'Multa pendiente',
      fecha_liberacion: editBanFecha || '',
    })
    if (ok) cerrarEdit()
  }

  const confirmarEliminar = async () => {
    if (!editModal || editDeleteConfirm !== editModal.username) return
    const ok = await accionAdmin('eliminar_jugador', { player_id: editModal.id })
    if (ok) cerrarEdit()
  }

  return (
    <>
      <div id="tab-jugadores" className="fade-in">
        {/* SUSPENDIDOS */}
        {baneados.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <SectionHeader title="SUSPENDIDOS" count={baneados.length} color="var(--red)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {baneados.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 16px', background: '#1a0808',
                  border: '1px solid #3a1a1a', borderRadius: 3,
                  flexWrap: 'wrap', gap: 12,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 15 }}>{p.username}</span>
                      <span className="badge badge-red">BANEADO</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {p.razon_ban}
                      {p.fecha_liberacion && ` · hasta ${new Date(p.fecha_liberacion).toLocaleDateString('es-CO')}`}
                    </div>
                  </div>
                  <ButtonGroup gap={8}>
                    <button onClick={() => abrirEdit(p)} className="btn btn-ghost" style={{ fontSize: 11, padding: '8px 14px' }}>
                      Editar
                    </button>
                    <button
                      onClick={() => accionAdmin('liberar', { player_id: p.id })}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '8px 16px', color: 'var(--green)', borderColor: '#16a34a' }}
                    >
                      Liberar
                    </button>
                  </ButtonGroup>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ACTIVOS */}
        <div>
          <SectionHeader title="MIEMBROS ACTIVOS" count={activos.length} color="var(--text-muted)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {activos.map(p => {
              const hasPush = playerIdsWithPush.has(p.id)
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'var(--bg-card)',
                  border: '1px solid var(--border)', borderRadius: 3, gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <PlayerAvatar url={p.avatar_url} username={p.username} size={32} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{p.username}</span>
                        {p.role === 'superadmin' && (
                          <span className="mono" style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.1em', background: '#1a0a2e', border: '1px solid #7c3aed', padding: '2px 5px', borderRadius: 2 }}>SUPERADMIN</span>
                        )}
                        {p.role === 'admin' && (
                          <span className="mono" style={{ fontSize: 9, color: 'var(--amber)', letterSpacing: '0.1em', background: '#2d1f00', border: '1px solid #92400e', padding: '2px 5px', borderRadius: 2 }}>ADMIN</span>
                        )}
                        {usarUniforme && p.uniform && !isPrivileged(p.role) && (
                          <span className="mono" style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '0.1em', background: '#0f2d1a', padding: '2px 5px', borderRadius: 2 }}>UNIFORME</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!isPrivileged(p.role) && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      <span title={hasPush ? 'Notificaciones activadas' : 'Sin notificaciones'} style={{ fontSize: 15, opacity: hasPush ? 1 : 0.3, cursor: 'default', lineHeight: 1 }}>
                        {hasPush ? '🔔' : '🔕'}
                      </span>
                      {usarUniforme && (
                        <button
                          onClick={() => accionAdmin('toggle_uniform', { player_id: p.id })}
                          title={p.uniform ? 'Tiene uniforme — clic para quitar' : 'Sin uniforme — clic para asignar'}
                          style={{
                            fontSize: 15, padding: '4px 6px', borderRadius: 3, cursor: 'pointer',
                            background: p.uniform ? '#0f2d1a' : 'transparent',
                            color: p.uniform ? 'var(--green)' : 'var(--text-dim)',
                            border: `1px solid ${p.uniform ? '#16a34a' : 'var(--border)'}`,
                            lineHeight: 1,
                          }}
                        >
                          👕
                        </button>
                      )}
                      <button onClick={() => abrirEdit(p)} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>
                        Editar
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Modal Editar Jugador */}
      {editModal && (
        <ModalOverlay>
          <Card style={{ width: '100%', maxWidth: 420, margin: 'auto', overflowY: 'auto', maxHeight: '80vh' }} padding={24}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <PlayerAvatar url={editModal.avatar_url} username={editModal.username} size={48} />
              <div>
                <div className="display" style={{ fontSize: 20 }}>{editModal.username}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{editModal.email}</div>
              </div>
            </div>

            {isSuperAdmin && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <FormLabel label="EMAIL" />
                    <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="email@ejemplo.com" />
                  </div>
                  <div>
                    <FormLabel label="NUEVA CONTRASEÑA" />
                    <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="Dejar vacío para no cambiar" autoComplete="new-password" />
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>Mínimo 6 caracteres. Vacío = sin cambio.</div>
                  </div>
                </div>
                <ButtonGroup gap={12} marginTop={20}>
                  <button onClick={confirmarEdit} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Guardar cambios</button>
                  <button onClick={cerrarEdit} className="btn btn-ghost">Cancelar</button>
                </ButtonGroup>
              </>
            )}
            {!isSuperAdmin && (
              <div style={{ marginTop: 4 }}>
                <button onClick={cerrarEdit} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Cerrar</button>
              </div>
            )}

            {/* Danger zone */}
            <div style={{ marginTop: 28, borderTop: '1px solid #3a1a1a', paddingTop: 20 }}>
              <SectionHeader title="ZONA DE RIESGO" color="#7f1d1d" />

              {!editModal.baneado && (
                <div style={{ marginBottom: 14 }}>
                  <button
                    onClick={() => { setEditSuspenderOpen(o => !o); setEditDeleteOpen(false) }}
                    className="btn btn-danger"
                    style={{ fontSize: 11, padding: '8px 16px', width: '100%', justifyContent: 'center' }}
                  >
                    {editSuspenderOpen ? '↑ Cancelar suspensión' : 'Suspender jugador'}
                  </button>
                  {editSuspenderOpen && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12, background: '#1a0808', border: '1px solid #3a1a1a', borderRadius: 3, padding: 14 }}>
                      <div>
                        <FormLabel label="RAZÓN" />
                        <input type="text" value={editBanRazon} onChange={e => setEditBanRazon(e.target.value)} placeholder="Multa pendiente, no asistió..." />
                      </div>
                      <div>
                        <FormLabel label="FECHA DE LIBERACIÓN (opcional)" />
                        <input type="date" value={editBanFecha} onChange={e => setEditBanFecha(e.target.value)} />
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>Vacío = ban indefinido.</div>
                      </div>
                      <button onClick={confirmarSuspender} className="btn btn-danger" style={{ justifyContent: 'center', padding: '10px' }}>
                        Confirmar suspensión
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isSuperAdmin && <div>
                <button
                  onClick={() => { setEditDeleteOpen(o => !o); setEditSuspenderOpen(false); setEditDeleteConfirm('') }}
                  className="mono"
                  style={{ fontSize: 11, padding: '8px 16px', width: '100%', textAlign: 'center', background: 'none', border: '1px solid #7f1d1d', borderRadius: 3, color: '#7f1d1d', cursor: 'pointer', letterSpacing: '0.08em' }}
                >
                  {editDeleteOpen ? '↑ Cancelar' : 'Eliminar jugador permanentemente'}
                </button>
                {editDeleteOpen && (
                  <div style={{ marginTop: 12, background: '#1a0808', border: '1px solid #7f1d1d', borderRadius: 3, padding: 14 }}>
                    <p className="mono" style={{ fontSize: 12, color: 'var(--red)', marginBottom: 12, lineHeight: 1.5 }}>
                      Esta acción es <strong>irreversible</strong>. Se eliminará la cuenta y todas sus inscripciones históricas.
                    </p>
                    <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                      Escribe <strong style={{ color: 'var(--red)' }}>{editModal.username}</strong> para confirmar
                    </label>
                    <input
                      type="text"
                      value={editDeleteConfirm}
                      onChange={e => setEditDeleteConfirm(e.target.value)}
                      placeholder={editModal.username}
                      style={{ marginBottom: 12 }}
                    />
                    <button
                      onClick={confirmarEliminar}
                      disabled={editDeleteConfirm !== editModal.username}
                      className="btn btn-danger"
                      style={{ width: '100%', justifyContent: 'center', padding: '10px', opacity: editDeleteConfirm !== editModal.username ? 0.4 : 1 }}
                    >
                      Eliminar permanentemente
                    </button>
                  </div>
                )}
              </div>}
            </div>
          </Card>
        </ModalOverlay>
      )}
    </>
  )
}

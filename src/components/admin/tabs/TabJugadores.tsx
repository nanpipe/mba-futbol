'use client'

import { useState } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SectionHeader } from '@/components/SectionHeader'
import { FormLabel } from '@/components/FormLabel'
import { ButtonGroup } from '@/components/ButtonGroup'
import { Card } from '@/components/Card'
import { ModalOverlay } from '@/components/ModalOverlay'
import { PerfilJugadorModal } from '@/components/admin/PerfilJugadorModal'
import type { Player, AdminAction } from '@/types/admin'
import { ratingTierStyle, formatRating } from '@/lib/tier'
import { fechaColombia } from '@/lib/promoHora'
import { AUSENCIA_MAX_DIAS } from '@/lib/ausencia'

const fechaCorta = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })

// El color del rol es la única señal de jerarquía en la lista, así que va en la
// tarjeta entera (barra lateral + fondo) y no solo en una etiqueta de 9 px.
const COLOR_ROL: Record<string, { acento: string; fondo: string; borde: string; etiqueta: string | null }> = {
  superadmin: { acento: '#a78bfa', fondo: '#150b26', borde: '#3f2370', etiqueta: 'SUPERADMIN' },
  admin:      { acento: '#fbbf24', fondo: '#1c1503', borde: '#4d3a10', etiqueta: 'ADMIN' },
  player:     { acento: '#4ade80', fondo: 'var(--bg-card)', borde: 'var(--border)', etiqueta: null },
}
const colorDeRol = (role: string) => COLOR_ROL[role] ?? COLOR_ROL.player

type Filtro = 'uniforme' | 'push'

function ChipFiltro({ activo, onClick, color, children }: {
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

  // ── Filtros y orden de la lista de activos ────────────────────────────────
  // Con 37 miembros la lista no se recorre, se busca. Los filtros son los tres
  // datos por los que un admin abre esta pantalla: quién tiene uniforme, a
  // quién le llegan las notificaciones, y quién está arriba en puntaje.
  const [filtros, setFiltros] = useState<Set<Filtro>>(new Set())
  const [porPuntaje, setPorPuntaje] = useState(false)
  const alternarFiltro = (f: Filtro) => setFiltros(prev => {
    const s = new Set(prev)
    if (s.has(f)) s.delete(f); else s.add(f)
    return s
  })

  const todosActivos = players.filter(p => p.aprobado && !p.baneado)
  const conUniforme = todosActivos.filter(p => p.uniform).length
  const conPush = todosActivos.filter(p => playerIdsWithPush.has(p.id)).length

  const activos = todosActivos
    .filter(p => !filtros.has('uniforme') || p.uniform)
    .filter(p => !filtros.has('push') || playerIdsWithPush.has(p.id))
    .sort((a, b) => {
      // Por puntaje el rol no manda: la pregunta es quién juega mejor, y un
      // admin en la mitad de la tabla debe salir en la mitad de la tabla.
      if (porPuntaje) {
        const d = (b.habilidad ?? 3) - (a.habilidad ?? 3)
        if (d !== 0) return d
        return a.username.localeCompare(b.username)
      }
      const ro = roleOrder(a.role) - roleOrder(b.role)
      if (ro !== 0) return ro
      return a.username.localeCompare(b.username)
    })

  // Qué tarjeta está abierta. Una sola: abrir otra cierra la anterior, si no la
  // lista se llena de botones y se pierde la ventaja de haberlos quitado.
  const [abiertoId, setAbiertoId] = useState<string | null>(null)

  const toggleUniforme = async () => {
    if (!editModal) return
    const ok = await accionAdmin('toggle_uniform', { player_id: editModal.id })
    if (ok) setEditModal(prev => prev ? { ...prev, uniform: !prev.uniform } : prev)
  }

  // ── Ausencia ────────────────────────────────────────────────────────────
  // Vive dentro del modal de editar. Por eso "Editar" se muestra también para
  // admins y superadmins: marcar ausencia es lo único que se les puede hacer,
  // y antes tenían su propio botón ✈️ en la fila.
  const [ausenciaHasta, setAusenciaHasta] = useState('')
  const hoy = fechaColombia()
  const maxAusencia = fechaColombia(new Date(Date.now() + AUSENCIA_MAX_DIAS * 86400000))
  const ausenteActiva = (p: Player) => !!p.ausente_hasta && p.ausente_hasta >= hoy

  const guardarAusencia = async (hasta: string) => {
    if (!editModal) return
    const ok = await accionAdmin('marcar_ausencia', { player_id: editModal.id, hasta })
    if (ok) cerrarEdit()
  }

  // ── Ver perfil ──────────────────────────────────────────────────────────
  const [perfilId, setPerfilId] = useState<string | null>(null)

  const abrirEdit = (p: Player) => {
    setEditModal(p)
    setEditEmail(p.email)
    setEditPassword('')
    setEditSuspenderOpen(false)
    setEditBanRazon('')
    setEditBanFecha('')
    setEditDeleteOpen(false)
    setEditDeleteConfirm('')
    setAusenciaHasta(ausenteActiva(p) ? p.ausente_hasta! : '')
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

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {usarUniforme && (
              <ChipFiltro activo={filtros.has('uniforme')} onClick={() => alternarFiltro('uniforme')}>
                👕 UNIFORME {conUniforme}
              </ChipFiltro>
            )}
            <ChipFiltro activo={filtros.has('push')} color="var(--amber)" onClick={() => alternarFiltro('push')}>
              🔔 AVISOS {conPush}
            </ChipFiltro>
            <ChipFiltro activo={porPuntaje} color="#a78bfa" onClick={() => setPorPuntaje(v => !v)}>
              ★ MAYOR PUNTAJE
            </ChipFiltro>
            {(filtros.size > 0 || porPuntaje) && (
              <button
                onClick={() => { setFiltros(new Set()); setPorPuntaje(false) }}
                className="mono"
                style={{ padding: '6px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 3, border: 'none', background: 'none', color: 'var(--text-dim)' }}
              >
                limpiar
              </button>
            )}
          </div>

          {activos.length === 0 && (
            <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', padding: '16px 0' }}>
              Nadie cumple con esos filtros.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {activos.map(p => {
              const hasPush = playerIdsWithPush.has(p.id)
              const c = colorDeRol(p.role)
              const abierto = abiertoId === p.id
              return (
                <div key={p.id} style={{
                  background: c.fondo, border: `1px solid ${abierto ? c.acento : c.borde}`,
                  borderLeft: `4px solid ${c.acento}`, borderRadius: 4, overflow: 'hidden',
                }}>
                  {/* La fila entera es el botón: sin "Ver" y "Editar" en cada
                      renglón cabe un avatar del doble de tamaño, que es lo que
                      de verdad identifica a alguien de un vistazo. */}
                  <button
                    onClick={() => setAbiertoId(abierto ? null : p.id)}
                    aria-expanded={abierto}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                    }}
                  >
                    <PlayerAvatar url={p.avatar_url} username={p.username} size={52} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 16, fontWeight: 500 }}>{p.username}</span>
                        {c.etiqueta && (
                          <span className="mono" style={{
                            fontSize: 9, color: c.acento, letterSpacing: '0.1em',
                            border: `1px solid ${c.acento}`, padding: '2px 5px', borderRadius: 2,
                          }}>
                            {c.etiqueta}
                          </span>
                        )}
                        {/* La campana solo cuando SÍ tiene avisos. El 🔕 en
                            treinta y siete filas era ruido: lo normal no
                            necesita ícono, lo excepcional sí. */}
                        {hasPush && <span title="Notificaciones activadas" style={{ fontSize: 13, lineHeight: 1 }}>🔔</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                        ★{formatRating(p.habilidad)}
                        <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
                          {ratingTierStyle(p.habilidad ?? 3).label}
                        </span>
                      </div>
                      {ausenteActiva(p) && (
                        <div className="mono" style={{
                          fontSize: 9, color: '#7dd3fc', letterSpacing: '0.1em', marginTop: 5,
                          background: '#082f49', border: '1px solid #0369a1',
                          padding: '2px 5px', borderRadius: 2, display: 'inline-block',
                        }}>
                          ✈️ AUSENTE · {fechaCorta(p.ausente_hasta!)}
                        </div>
                      )}
                    </div>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>
                      {abierto ? '▲' : '▼'}
                    </span>
                  </button>

                  {abierto && (
                    <div style={{ padding: '0 12px 12px' }}>
                      {/* Solo "Ver". Editar vive adentro de la ficha: es donde
                          se ve a quién se le va a cambiar algo. */}
                      <button
                        onClick={() => setPerfilId(p.id)}
                        className="btn btn-ghost"
                        style={{ width: '100%', justifyContent: 'center', fontSize: 12, padding: '9px' }}
                      >
                        Ver ficha de {p.username}
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

            {/* ── Ausencia ── */}
            <div style={{
              marginBottom: 20, padding: '14px 16px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4,
            }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
                ✈️ AUSENCIA
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 14 }}>
                Para viajes o lesiones. Mientras esté ausente:<br />
                · no pierde puntaje por no inscribirse<br />
                · no recibe avisos de inscripción ni de cupos<br />
                · no puede inscribirse solo — si vuelve antes, quítasela<br />
                · si juega igual, el partido cuenta normal
              </div>

              {ausenteActiva(editModal) && (
                <div className="mono" style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 12 }}>
                  Ausente desde el {fechaCorta(editModal.ausente_desde!)} hasta el {fechaCorta(editModal.ausente_hasta!)}.
                </div>
              )}

              <FormLabel label="AUSENTE HASTA" />
              <input type="date" value={ausenciaHasta} min={hoy} max={maxAusencia} onChange={e => setAusenciaHasta(e.target.value)} />
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                Empieza hoy. Máximo {AUSENCIA_MAX_DIAS} días.
              </div>

              <ButtonGroup gap={10} marginTop={14}>
                <button
                  onClick={() => guardarAusencia(ausenciaHasta)}
                  disabled={!ausenciaHasta}
                  className="btn btn-ghost"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 11, opacity: ausenciaHasta ? 1 : 0.4 }}
                >
                  {ausenteActiva(editModal) ? 'Actualizar ausencia' : 'Marcar ausente'}
                </button>
                {ausenteActiva(editModal) && (
                  <button
                    onClick={() => guardarAusencia('')}
                    className="btn btn-ghost"
                    style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    Volvió
                  </button>
                )}
              </ButtonGroup>
            </div>

            {usarUniforme && !isPrivileged(editModal.role) && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '12px 14px', marginBottom: 20,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>👕</span>
                  {editModal.uniform ? (
                    <span className="mono" style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '0.1em', background: '#0f2d1a', padding: '2px 5px', borderRadius: 2 }}>UNIFORME</span>
                  ) : (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sin uniforme</span>
                  )}
                </div>
                <button
                  onClick={toggleUniforme}
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap' }}
                >
                  {editModal.uniform ? 'Quitar' : 'Asignar'}
                </button>
              </div>
            )}

            {isSuperAdmin && !isPrivileged(editModal.role) && (
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
            {(!isSuperAdmin || isPrivileged(editModal.role)) && (
              <div style={{ marginTop: 4 }}>
                <button onClick={cerrarEdit} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Cerrar</button>
              </div>
            )}

            {/* Danger zone — no aplica a admins: el API rechaza suspenderlos y
                eliminarlos, así que mostrar los botones sería mentir. */}
            {!isPrivileged(editModal.role) && (
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
            )}
          </Card>
        </ModalOverlay>
      )}

      {/* Ficha del jugador — solo lectura, con la puerta a editar */}
      {perfilId && (
        <PerfilJugadorModal
          playerId={perfilId}
          onClose={() => setPerfilId(null)}
          onEditar={() => {
            const p = players.find(j => j.id === perfilId)
            if (!p) return
            setPerfilId(null)
            abrirEdit(p)
          }}
        />
      )}
    </>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Player {
  id: string
  username: string
  email: string
  baneado: boolean
  aprobado: boolean
  uniform: boolean
  fecha_liberacion: string | null
  razon_ban: string | null
  ip_registro: string | null
  created_at: string
  avatar_url: string | null
}

function PlayerAvatar({ url, username, size = 32 }: { url: string | null; username: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: url ? 'transparent' : '#0f2d1a',
      border: '1px solid var(--border)',
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {url ? (
        <img src={url} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span className="display" style={{ fontSize: size * 0.4, color: 'var(--green)', lineHeight: 1 }}>
          {username?.[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  )
}

interface ActivityLog {
  id: string
  user_id: string | null
  username: string | null
  accion: string
  detalles: Record<string, unknown> | null
  ip: string | null
  created_at: string
}

interface Invitado {
  id: string
  nombre: string
  estado: 'espera' | 'confirmado'
  posicion_espera: number | null
  player_id: string
  profiles: { username: string }
}

interface Inscripcion {
  id: string
  estado: 'confirmado' | 'espera'
  posicion_espera: number | null
  partido_id: string
  profiles: { username: string; id: string }
  partidos: { fecha: string; dia_semana: string }
}

interface Partido {
  id: string
  fecha: string
  dia_semana: string
  inscripciones: { count: number }[]
}

export default function AdminPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'partidos' | 'jugadores' | 'notifs' | 'log'>('partidos')
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [playerIdsWithPush, setPlayerIdsWithPush] = useState<Set<string>>(new Set())
  const [partidos, setPartidos] = useState<Partido[]>([])
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([])
  const [invitados, setInvitados] = useState<Invitado[]>([])
  const [selectedPartido, setSelectedPartido] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mensaje, setMensaje] = useState('')

  // Log tab
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Modal crear partido
  const [crearModal, setCrearModal] = useState(false)
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [nuevaHora, setNuevaHora] = useState('19:00')
  const [nuevosCupos, setNuevosCupos] = useState('14')
  const [nuevaHoraApertura, setNuevaHoraApertura] = useState('10:00')
  const [nuevosDiasAntes, setNuevosDiasAntes] = useState('2')

  // Modal editar jugador (also handles suspend + delete)
  const [editModal, setEditModal] = useState<Player | null>(null)
  const [editUsername, setEditUsername] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editSuspenderOpen, setEditSuspenderOpen] = useState(false)
  const [editBanRazon, setEditBanRazon] = useState('')
  const [editBanFecha, setEditBanFecha] = useState('')
  const [editDeleteOpen, setEditDeleteOpen] = useState(false)
  const [editDeleteConfirm, setEditDeleteConfirm] = useState('')

  // Test push
  const [pushTitle, setPushTitle] = useState('MBA FC')
  const [pushBody, setPushBody] = useState('¡Hay cupo en el partido! Entra a inscribirte ⚽')
  const [pushTarget, setPushTarget] = useState('')
  const [pushSending, setPushSending] = useState(false)

  const cargarDatos = useCallback(async () => {
    const [{ data: ps }, { data: pushSubs }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, email, baneado, aprobado, uniform, fecha_liberacion, razon_ban, ip_registro, created_at, avatar_url')
        .neq('role', 'admin')
        .order('created_at', { ascending: false }),
      supabase.from('push_subscriptions').select('player_id'),
    ])
    setPlayers(ps ?? [])
    setPlayerIdsWithPush(new Set((pushSubs ?? []).map((s: { player_id: string }) => s.player_id)))

    const { data: pts } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana, inscripciones(count)')
      .gte('fecha', new Date().toISOString().split('T')[0])
      .order('fecha', { ascending: true })
      .limit(8)
    setPartidos(pts ?? [])
  }, [supabase])

  const cargarInscripciones = useCallback(async (partidoId: string) => {
    const { data } = await supabase
      .from('inscripciones')
      .select('id, estado, posicion_espera, partido_id, profiles(username, id), partidos(fecha, dia_semana)')
      .eq('partido_id', partidoId)
      .order('estado', { ascending: true })
      .order('posicion_espera', { ascending: true, nullsFirst: false })
    setInscripciones((data as unknown as Inscripcion[]) ?? [])

    const { data: inv } = await supabase
      .from('invitados')
      .select('id, nombre, estado, posicion_espera, player_id, profiles(username)')
      .eq('partido_id', partidoId)
      .order('estado', { ascending: true })
      .order('posicion_espera', { ascending: true, nullsFirst: false })
    setInvitados((inv as unknown as Invitado[]) ?? [])
  }, [supabase])

  const cargarLogs = useCallback(async () => {
    setLogsLoading(true)
    const res = await fetch('/api/admin?accion=logs')
    if (res.ok) {
      const data = await res.json()
      setLogs(data.logs ?? [])
    }
    setLogsLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'admin') { window.location.href = '/'; return }
      setAuthed(true)
      await cargarDatos()
      setLoading(false)
    })
  }, [supabase, cargarDatos])

  useEffect(() => {
    if (selectedPartido) cargarInscripciones(selectedPartido)
  }, [selectedPartido, cargarInscripciones])

  useEffect(() => {
    if (tab === 'log') cargarLogs()
  }, [tab, cargarLogs])

  const flash = (msg: string) => {
    setMensaje(msg)
    setTimeout(() => setMensaje(''), 4000)
  }

  const accionAdmin = async (accion: string, extra: Record<string, string | boolean>) => {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, ...extra }),
    })
    const data = await res.json()
    if (res.ok) {
      flash(data.mensaje ?? 'Hecho.')
      await cargarDatos()
      if (selectedPartido) await cargarInscripciones(selectedPartido)
    } else {
      flash(`Error: ${data.error}`)
    }
    return res.ok
  }

  const abrirEdit = (p: Player) => {
    setEditModal(p)
    setEditUsername(p.username)
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
    await accionAdmin('editar_jugador', { player_id: editModal.id, username: editUsername, email: editEmail })
    if (editPassword.trim().length >= 6) {
      await accionAdmin('cambiar_password', { player_id: editModal.id, password: editPassword.trim() })
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

  const crearPartido = async () => {
    if (!nuevaFecha) return
    await accionAdmin('crear_partido', {
      fecha: nuevaFecha,
      hora: nuevaHora + ':00',
      cupos_total: nuevosCupos,
      hora_apertura: nuevaHoraApertura + ':00',
      dias_antes_apertura: nuevosDiasAntes,
    })
    setCrearModal(false)
    setNuevaFecha('')
    setNuevaHora('19:00')
    setNuevosCupos('14')
    setNuevaHoraApertura('10:00')
    setNuevosDiasAntes('2')
  }

  const enviarPushTest = async () => {
    setPushSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ title: pushTitle, body: pushBody, player_id: pushTarget || undefined }),
    })
    const data = await res.json()
    setMensaje(data.mensaje ?? data.error ?? 'Error desconocido')
    setTimeout(() => setMensaje(''), 8000)
    setPushSending(false)
  }

  if (authed === null || loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>CARGANDO...</div>
      </div>
    )
  }

  const pendientes = players.filter(p => !p.aprobado && !p.baneado)
  const baneados = players.filter(p => p.baneado)
  const activos = players.filter(p => p.aprobado && !p.baneado)

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
            <span className="display" style={{ fontSize: 20, letterSpacing: '0.1em', color: 'var(--amber)' }}>ADMIN</span>
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>MBA FÚTBOL CLUB</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 40 }}>

        {mensaje && (
          <div className="mono fade-in" style={{
            fontSize: 13, padding: '12px 16px', borderRadius: 3, marginBottom: 24,
            background: mensaje.startsWith('Error') ? '#2d0a0a' : '#0f2d1a',
            color: mensaje.startsWith('Error') ? 'var(--red)' : 'var(--green)',
            border: `1px solid ${mensaje.startsWith('Error') ? '#7f1d1d' : '#16a34a'}`
          }}>
            {mensaje}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 40, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {(['partidos', 'jugadores', 'notifs', 'log'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="mono" style={{
              padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1,
              position: 'relative',
            }}>
              {t}
              {t === 'jugadores' && pendientes.length > 0 && (
                <span style={{
                  position: 'absolute', top: 8, right: 4,
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--amber)',
                }} />
              )}
            </button>
          ))}
        </div>

        {/* TAB: PARTIDOS */}
        {tab === 'partidos' && (
          <div className="fade-in">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 24, alignItems: 'start' }}>

              {/* Lista de partidos */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                    PRÓXIMOS PARTIDOS
                  </div>
                  <button
                    onClick={() => setCrearModal(true)}
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '6px 12px', color: 'var(--green)', borderColor: '#16a34a' }}
                  >
                    + Nuevo
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {partidos.map(p => {
                    const total = (p.inscripciones?.[0] as { count: number } | undefined)?.count ?? 0
                    const confirmados = Math.min(total, 14)
                    const espera = Math.max(0, total - 14)
                    return (
                      <button key={p.id} onClick={() => setSelectedPartido(p.id)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', background: selectedPartido === p.id ? 'var(--bg-elevated)' : 'var(--bg-card)',
                        border: `1px solid ${selectedPartido === p.id ? 'var(--green)' : 'var(--border)'}`,
                        borderRadius: 3, cursor: 'pointer', textAlign: 'left'
                      }}>
                        <div>
                          <div className="display" style={{ fontSize: 18, letterSpacing: '0.05em', color: selectedPartido === p.id ? 'var(--green)' : 'var(--text)' }}>
                            {p.dia_semana.toUpperCase()}
                          </div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="mono" style={{ fontSize: 13 }}>
                            <span style={{ color: confirmados >= 14 ? 'var(--red)' : 'var(--green)' }}>{confirmados}</span>
                            <span style={{ color: 'var(--text-dim)' }}>/14</span>
                          </div>
                          {espera > 0 && (
                            <div className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>+{espera} espera</div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Inscripciones del partido seleccionado */}
              <div>
                {selectedPartido ? (
                  <>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 16 }}>
                      INSCRITOS
                    </div>
                    {inscripciones.length === 0 ? (
                      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
                        <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin inscripciones aún.</p>
                      </div>
                    ) : (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {inscripciones.map(ins => (
                          <div key={ins.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 14px', background: 'var(--bg-card)',
                            border: '1px solid var(--border)', borderRadius: 3
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span className={`badge ${ins.estado === 'confirmado' ? 'badge-green' : 'badge-amber'}`}>
                                {ins.estado === 'confirmado' ? '✓' : `#${ins.posicion_espera}`}
                              </span>
                              <span style={{ fontSize: 15 }}>{ins.profiles.username}</span>
                            </div>
                            <button
                              onClick={() => accionAdmin('remover_partido', { player_id: ins.profiles.id, partido_id: ins.partido_id })}
                              className="mono"
                              style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}
                            >
                              REMOVER
                            </button>
                          </div>
                        ))}
                      </div>

                      {invitados.length > 0 && (
                        <div style={{ marginTop: 20 }}>
                          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>
                            INVITADOS — {invitados.length}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {invitados.map(inv => (
                              <div key={inv.id} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '10px 14px', background: 'var(--bg-card)',
                                border: '1px solid #1a2a3a', borderRadius: 3
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <span className={`badge ${inv.estado === 'confirmado' ? 'badge-green' : 'badge-amber'}`}>
                                    {inv.estado === 'confirmado' ? '✓' : `#${inv.posicion_espera}`}
                                  </span>
                                  <div>
                                    <div style={{ fontSize: 14 }}>{inv.nombre}</div>
                                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>inv. de {inv.profiles.username}</div>
                                  </div>
                                </div>
                                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>INVITADO</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="card" style={{ textAlign: 'center', padding: 48 }}>
                    <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Selecciona un partido para ver los inscritos.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB: JUGADORES */}
        {tab === 'jugadores' && (
          <div className="fade-in">

            {/* PENDIENTES */}
            {pendientes.length > 0 && (
              <div style={{ marginBottom: 40 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--amber)', marginBottom: 16 }}>
                  PENDIENTES DE APROBACIÓN — {pendientes.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {pendientes.map(p => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', background: '#1a1500',
                      border: '1px solid #3a3000', borderRadius: 3,
                      flexWrap: 'wrap', gap: 12
                    }}>
                      <div>
                        <div style={{ fontSize: 15, marginBottom: 2 }}>{p.username}</div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                          {p.email}
                          {p.ip_registro && <span style={{ marginLeft: 8, color: 'var(--text-dim)' }}>· IP: {p.ip_registro}</span>}
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          {new Date(p.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => accionAdmin('aprobar_jugador', { player_id: p.id })}
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '8px 16px', color: 'var(--green)', borderColor: '#16a34a' }}
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`¿Rechazar y eliminar la solicitud de ${p.username}?`)) {
                              accionAdmin('rechazar_jugador', { player_id: p.id })
                            }
                          }}
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '8px 14px', color: 'var(--red)', borderColor: '#7f1d1d' }}
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SUSPENDIDOS */}
            {baneados.length > 0 && (
              <div style={{ marginBottom: 40 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--red)', marginBottom: 16 }}>
                  SUSPENDIDOS — {baneados.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {baneados.map(p => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', background: '#1a0808',
                      border: '1px solid #3a1a1a', borderRadius: 3,
                      flexWrap: 'wrap', gap: 12
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
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => abrirEdit(p)}
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '8px 14px' }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => accionAdmin('liberar', { player_id: p.id })}
                          className="btn btn-ghost"
                          style={{ fontSize: 12, padding: '8px 16px', color: 'var(--green)', borderColor: '#16a34a' }}
                        >
                          Liberar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ACTIVOS */}
            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 16 }}>
                JUGADORES ACTIVOS — {activos.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activos.map(p => {
                  const hasPush = playerIdsWithPush.has(p.id)
                  return (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', background: 'var(--bg-card)',
                      border: '1px solid var(--border)', borderRadius: 3, gap: 10
                    }}>
                      {/* Left: avatar + name + badges */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <PlayerAvatar url={p.avatar_url} username={p.username} size={32} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 500 }}>{p.username}</span>
                            {p.uniform && (
                              <span className="mono" style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '0.1em', background: '#0f2d1a', padding: '2px 5px', borderRadius: 2 }}>UNIFORME</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Right: icons + edit */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                        {/* Push bell */}
                        <span
                          title={hasPush ? 'Notificaciones activadas' : 'Sin notificaciones'}
                          style={{ fontSize: 15, opacity: hasPush ? 1 : 0.3, cursor: 'default', lineHeight: 1 }}
                        >
                          {hasPush ? '🔔' : '🔕'}
                        </span>
                        {/* Uniform toggle */}
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
                        <button
                          onClick={() => abrirEdit(p)}
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '6px 12px' }}
                        >
                          Editar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB: NOTIFICACIONES */}
        {tab === 'notifs' && (
          <div className="fade-in" style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: 480 }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 24 }}>
              ENVIAR NOTIFICACIÓN DE PRUEBA
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>TÍTULO</label>
                <input type="text" value={pushTitle} onChange={e => setPushTitle(e.target.value)} />
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>MENSAJE</label>
                <input type="text" value={pushBody} onChange={e => setPushBody(e.target.value)} />
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>DESTINATARIO</label>
                <select value={pushTarget} onChange={e => setPushTarget(e.target.value)} style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>
                  <option value="">Todos los jugadores</option>
                  {players.map(p => (
                    <option key={p.id} value={p.id}>{p.username}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={enviarPushTest}
                disabled={pushSending}
                className="btn btn-primary"
                style={{ padding: '14px', fontSize: 13 }}
              >
                {pushSending ? 'Enviando...' : 'Enviar notificación'}
              </button>
            </div>

            <div className="card" style={{ marginTop: 32, borderColor: '#1a2a1a' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 12 }}>CHECKLIST</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'El jugador tiene que haber tocado "🔔 Notificaciones" y aceptado el permiso',
                  'En iOS, la app debe estar agregada al Home Screen primero',
                  'La tabla push_subscriptions debe existir en Supabase',
                  'NEXT_PUBLIC_PUSHER_APP_KEY y PUSHER_APP_SECRET deben estar configurados',
                ].map((item, i) => (
                  <div key={i} className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--green)' }}>·</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            </div>
          </div>
        )}

        {/* TAB: LOG */}
        {tab === 'log' && (
          <div className="fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                ACTIVIDAD RECIENTE — {logs.length}
              </div>
              <button onClick={cargarLogs} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>
                ↻ Refrescar
              </button>
            </div>
            {logsLoading ? (
              <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Cargando...</div>
            ) : logs.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 48 }}>
                <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin actividad registrada aún.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {logs.map(log => (
                  <div key={log.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 16,
                    padding: '10px 14px', background: 'var(--bg-card)',
                    border: '1px solid var(--border)', borderRadius: 3,
                    flexWrap: 'wrap',
                  }}>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', minWidth: 110 }}>
                      {new Date(log.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                      {' '}
                      {new Date(log.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--amber)', minWidth: 80 }}>
                      {log.username ?? '—'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text)', letterSpacing: '0.05em' }}>
                        {log.accion}
                      </span>
                      {log.detalles && Object.keys(log.detalles).length > 0 && (
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {Object.entries(log.detalles)
                            .filter(([k]) => !['player_id'].includes(k))
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                    {log.ip && (
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {log.ip}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Crear Partido */}
      {crearModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, zIndex: 100
        }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 400 }}>
            <h3 className="display" style={{ fontSize: 24, marginBottom: 8 }}>Nuevo partido</h3>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
              El día de la semana se detecta automáticamente de la fecha.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>FECHA</label>
                <input type="date" value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>HORA DEL PARTIDO</label>
                <input type="time" value={nuevaHora} onChange={e => setNuevaHora(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>ABRIR INSCRIPCIONES</label>
                  <input type="time" value={nuevaHoraApertura} onChange={e => setNuevaHoraApertura(e.target.value)} />
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>hora de apertura</div>
                </div>
                <div>
                  <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>DÍAS ANTES</label>
                  <input type="number" min="0" max="7" value={nuevosDiasAntes} onChange={e => setNuevosDiasAntes(e.target.value)} />
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>días previos al partido</div>
                </div>
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>CUPOS</label>
                <input type="number" min="1" max="30" value={nuevosCupos} onChange={e => setNuevosCupos(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={crearPartido} disabled={!nuevaFecha} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Crear partido
              </button>
              <button onClick={() => setCrearModal(false)} className="btn btn-ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Jugador (includes suspend + delete danger zone) */}
      {editModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, zIndex: 100, overflowY: 'auto'
        }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 420, margin: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <PlayerAvatar url={editModal.avatar_url} username={editModal.username} size={48} />
              <div>
                <div className="display" style={{ fontSize: 20 }}>{editModal.username}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{editModal.email}</div>
              </div>
            </div>

            {/* ── Edit fields ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>NOMBRE DE USUARIO</label>
                <input type="text" value={editUsername} onChange={e => setEditUsername(e.target.value)} placeholder="username" />
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>EMAIL</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="email@ejemplo.com" />
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>NUEVA CONTRASEÑA</label>
                <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="Dejar vacío para no cambiar" autoComplete="new-password" />
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>Mínimo 6 caracteres. Vacío = sin cambio.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={confirmarEdit} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Guardar cambios
              </button>
              <button onClick={cerrarEdit} className="btn btn-ghost">Cancelar</button>
            </div>

            {/* ── Danger zone ── */}
            <div style={{ marginTop: 28, borderTop: '1px solid #3a1a1a', paddingTop: 20 }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: '#7f1d1d', marginBottom: 14 }}>
                ZONA DE RIESGO
              </div>

              {/* SUSPENDER */}
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
                        <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>RAZÓN</label>
                        <input type="text" value={editBanRazon} onChange={e => setEditBanRazon(e.target.value)} placeholder="Multa pendiente, no asistió..." />
                      </div>
                      <div>
                        <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>FECHA DE LIBERACIÓN (opcional)</label>
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

              {/* ELIMINAR */}
              <div>
                <button
                  onClick={() => { setEditDeleteOpen(o => !o); setEditSuspenderOpen(false); setEditDeleteConfirm('') }}
                  className="mono"
                  style={{
                    fontSize: 11, padding: '8px 16px', width: '100%', textAlign: 'center',
                    background: 'none', border: '1px solid #7f1d1d', borderRadius: 3,
                    color: '#7f1d1d', cursor: 'pointer', letterSpacing: '0.08em',
                  }}
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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

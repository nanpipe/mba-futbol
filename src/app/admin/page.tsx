'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Player {
  id: string
  username: string
  email: string
  baneado: boolean
  fecha_liberacion: string | null
  razon_ban: string | null
  ip_registro: string | null
  created_at: string
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
  const [tab, setTab] = useState<'partidos' | 'jugadores' | 'notifs'>('partidos')
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [partidos, setPartidos] = useState<Partido[]>([])
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([])
  const [selectedPartido, setSelectedPartido] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mensaje, setMensaje] = useState('')

  // Modal ban
  const [banModal, setBanModal] = useState<Player | null>(null)
  const [banRazon, setBanRazon] = useState('')
  const [banFecha, setBanFecha] = useState('')

  // Modal crear partido
  const [crearModal, setCrearModal] = useState(false)
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [nuevaHora, setNuevaHora] = useState('19:00')
  const [nuevosCupos, setNuevosCupos] = useState('14')

  // Modal editar jugador
  const [editModal, setEditModal] = useState<Player | null>(null)
  const [editUsername, setEditUsername] = useState('')
  const [editEmail, setEditEmail] = useState('')

  // Test push
  const [pushTitle, setPushTitle] = useState('MBA FC')
  const [pushBody, setPushBody] = useState('¡Hay cupo en el partido! Entra a inscribirte ⚽')
  const [pushTarget, setPushTarget] = useState('')
  const [pushSending, setPushSending] = useState(false)

  const cargarDatos = useCallback(async () => {
    const { data: ps } = await supabase
      .from('profiles')
      .select('id, username, email, baneado, fecha_liberacion, razon_ban, ip_registro, created_at')
      .neq('role', 'admin')
      .order('created_at', { ascending: false })
    setPlayers(ps ?? [])

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
  }, [supabase])

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

  const accionAdmin = async (accion: string, extra: Record<string, string>) => {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, ...extra }),
    })
    const data = await res.json()
    if (res.ok) {
      setMensaje(data.mensaje ?? 'Hecho.')
      await cargarDatos()
      if (selectedPartido) await cargarInscripciones(selectedPartido)
    } else {
      setMensaje(`Error: ${data.error}`)
    }
    setTimeout(() => setMensaje(''), 4000)
  }

  const confirmarBan = async () => {
    if (!banModal) return
    await accionAdmin('banear', {
      player_id: banModal.id,
      razon: banRazon || 'Multa pendiente',
      fecha_liberacion: banFecha || '',
    })
    setBanModal(null)
    setBanRazon('')
    setBanFecha('')
  }

  const crearPartido = async () => {
    if (!nuevaFecha) return
    await accionAdmin('crear_partido', {
      fecha: nuevaFecha,
      hora: nuevaHora + ':00',
      cupos_total: nuevosCupos,
    })
    setCrearModal(false)
    setNuevaFecha('')
    setNuevaHora('19:00')
    setNuevosCupos('14')
  }

  const confirmarEdit = async () => {
    if (!editModal) return
    await accionAdmin('editar_jugador', {
      player_id: editModal.id,
      username: editUsername,
      email: editEmail,
    })
    setEditModal(null)
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
    setMensaje(res.ok ? data.mensaje : `Error: ${data.error}`)
    setTimeout(() => setMensaje(''), 5000)
    setPushSending(false)
  }

  if (authed === null || loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>CARGANDO...</div>
      </div>
    )
  }

  const baneados = players.filter(p => p.baneado)
  const activos = players.filter(p => !p.baneado)

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
        <div style={{ display: 'flex', gap: 0, marginBottom: 40, borderBottom: '1px solid var(--border)' }}>
          {(['partidos', 'jugadores', 'notifs'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="mono" style={{
              padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1
            }}>
              {t}
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
                      border: '1px solid #3a1a1a', borderRadius: 3
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
                          onClick={() => { setEditModal(p); setEditUsername(p.username); setEditEmail(p.email) }}
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

            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 16 }}>
                JUGADORES ACTIVOS — {activos.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activos.map(p => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', background: 'var(--bg-card)',
                    border: '1px solid var(--border)', borderRadius: 3
                  }}>
                    <div>
                      <div style={{ fontSize: 15, marginBottom: 2 }}>{p.username}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.email}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => { setEditModal(p); setEditUsername(p.username); setEditEmail(p.email) }}
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '8px 14px' }}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setBanModal(p)}
                        className="btn btn-danger"
                        style={{ fontSize: 11, padding: '8px 14px' }}
                      >
                        Suspender
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TAB: NOTIFICACIONES */}
        {tab === 'notifs' && (
          <div className="fade-in" style={{ maxWidth: 480 }}>
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
        )}

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
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>HORA</label>
                <input type="time" value={nuevaHora} onChange={e => setNuevaHora(e.target.value)} />
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

      {/* Modal Editar Jugador */}
      {editModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, zIndex: 100
        }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 420 }}>
            <h3 className="display" style={{ fontSize: 24, marginBottom: 24 }}>Editar jugador</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>NOMBRE DE USUARIO</label>
                <input type="text" value={editUsername} onChange={e => setEditUsername(e.target.value)} placeholder="username" />
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>EMAIL</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="email@ejemplo.com" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={confirmarEdit} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Guardar cambios
              </button>
              <button onClick={() => setEditModal(null)} className="btn btn-ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ban */}
      {banModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, zIndex: 100
        }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 420 }}>
            <h3 className="display" style={{ fontSize: 24, marginBottom: 8 }}>
              Suspender a {banModal.username}
            </h3>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
              El jugador será removido de todos los partidos futuros y no podrá inscribirse.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                  RAZÓN
                </label>
                <input
                  type="text"
                  value={banRazon}
                  onChange={e => setBanRazon(e.target.value)}
                  placeholder="Multa pendiente, no asistió..."
                />
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                  FECHA DE LIBERACIÓN (opcional)
                </label>
                <input
                  type="date"
                  value={banFecha}
                  onChange={e => setBanFecha(e.target.value)}
                />
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                  Si no se especifica, el ban es indefinido hasta que lo liberes manualmente.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={confirmarBan} className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }}>
                Confirmar suspensión
              </button>
              <button onClick={() => setBanModal(null)} className="btn btn-ghost">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { posicionEmoji } from '@/lib/teamBalancer'

interface Player {
  id: string
  username: string
  email: string
  role: string
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

function DraggablePlayerCard({ jugador, equipo, confirmado }: { jugador: JugadorEquipo; equipo: 'A' | 'B'; confirmado: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: jugador.id,
    data: { equipo },
    disabled: confirmado,
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.25 : 1,
        padding: '8px 10px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        cursor: confirmado ? 'default' : 'grab',
        touchAction: 'none',
        display: 'flex', alignItems: 'center', gap: 8,
        userSelect: 'none',
        transition: 'opacity 0.1s',
      }}
      {...(!confirmado ? listeners : {})}
      {...(!confirmado ? attributes : {})}
    >
      <PlayerAvatar url={jugador.avatar_url} username={jugador.username} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jugador.username}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{posicionEmoji(jugador.posicion)} ★{jugador.habilidad.toFixed(1)}</div>
      </div>
      {!confirmado && <span style={{ color: 'var(--text-dim)', fontSize: 14, flexShrink: 0 }}>⠿</span>}
    </div>
  )
}

function DroppableZone({ equipo, children, isConfirmado }: { equipo: 'A' | 'B'; children: React.ReactNode; isConfirmado: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `equipo-${equipo}`, disabled: isConfirmado })
  const color = equipo === 'A' ? 'var(--green)' : 'var(--amber)'
  const bgOver = equipo === 'A' ? '#0a1f0f' : '#1a1500'
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 160,
        background: isOver ? bgOver : 'transparent',
        border: `2px dashed ${isOver ? color : 'var(--border)'}`,
        borderRadius: 6,
        padding: 8,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {children}
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

interface JugadorEquipo {
  id: string
  username: string
  avatar_url: string | null
  posicion: string
  habilidad: number
}

interface Partido {
  id: string
  fecha: string
  dia_semana: string
  inscripciones: { count: number }[]
  evaluaciones_abiertas?: boolean
  equipos_confirmados?: boolean
  resultado?: string | null
}

export default function AdminPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'partidos' | 'equipos' | 'jugadores' | 'notifs' | 'log'>('partidos')
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [playerIdsWithPush, setPlayerIdsWithPush] = useState<Set<string>>(new Set())
  const [partidos, setPartidos] = useState<Partido[]>([])
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([])
  const [invitados, setInvitados] = useState<Invitado[]>([])
  const [confirmandoInvitado, setConfirmandoInvitado] = useState<string | null>(null)
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

  // Equipos tab
  const [equiposPartido, setEquiposPartido] = useState<Partido | null>(null)
  const [equipoA, setEquipoA] = useState<JugadorEquipo[]>([])
  const [equipoB, setEquipoB] = useState<JugadorEquipo[]>([])
  const [equiposConfirmado, setEquiposConfirmado] = useState(false)
  const [equiposLoading, setEquiposLoading] = useState(false)
  const [equiposDraft, setEquiposDraft] = useState(false)
  const [equiposResultado, setEquiposResultado] = useState('')
  const [evaluacionesAbiertas, setEvaluacionesAbiertas] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  // Test push
  const [pushTitle, setPushTitle] = useState('MBA FC')
  const [pushBody, setPushBody] = useState('¡Hay cupo en el partido! Entra a inscribirte ⚽')
  const [pushTarget, setPushTarget] = useState('')
  const [pushSending, setPushSending] = useState(false)

  const cargarDatos = useCallback(async () => {
    const [{ data: ps }, { data: pushSubs }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, email, role, baneado, aprobado, uniform, fecha_liberacion, razon_ban, ip_registro, created_at, avatar_url')
        .order('created_at', { ascending: false }),
      supabase.from('push_subscriptions').select('player_id'),
    ])
    setPlayers(ps ?? [])
    setPlayerIdsWithPush(new Set((pushSubs ?? []).map((s: { player_id: string }) => s.player_id)))

    const { data: pts } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana, inscripciones(count), evaluaciones_abiertas, equipos_confirmados, resultado')
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

  const cargarEquipos = useCallback(async (partido: Partido) => {
    setEquiposLoading(true)
    setEquiposPartido(partido)
    setEquiposConfirmado(partido.equipos_confirmados ?? false)
    setEvaluacionesAbiertas(partido.evaluaciones_abiertas ?? false)
    setEquiposResultado(partido.resultado ?? '')
    setEquiposDraft(false)
    const res = await fetch(`/api/equipos?partido_id=${partido.id}`)
    const data = await res.json()
    if (data.equipos) {
      const ea = data.equipos.find((e: { nombre: string }) => e.nombre === 'A')
      const eb = data.equipos.find((e: { nombre: string }) => e.nombre === 'B')
      setEquipoA(ea?.jugadores ?? [])
      setEquipoB(eb?.jugadores ?? [])
    } else {
      setEquipoA([])
      setEquipoB([])
    }
    setEquiposLoading(false)
  }, [])

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null)
    const { active, over } = event
    if (!over) return
    const fromEquipo = active.data.current?.equipo as 'A' | 'B'
    const toEquipo = (over.id as string) === 'equipo-A' ? 'A' : 'B'
    if (fromEquipo === toEquipo) return
    const playerId = active.id as string
    if (fromEquipo === 'A') {
      const player = equipoA.find(p => p.id === playerId)
      if (player) { setEquipoA(equipoA.filter(p => p.id !== playerId)); setEquipoB([...equipoB, player]); setEquiposDraft(true) }
    } else {
      const player = equipoB.find(p => p.id === playerId)
      if (player) { setEquipoB(equipoB.filter(p => p.id !== playerId)); setEquipoA([...equipoA, player]); setEquiposDraft(true) }
    }
  }

  const balancearAutomatico = async () => {
    if (!equiposPartido) return
    setEquiposLoading(true)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'balancear', partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) { setEquipoA(data.equipoA ?? []); setEquipoB(data.equipoB ?? []); setEquiposDraft(true) }
    else flash(`Error: ${data.error}`)
    setEquiposLoading(false)
  }

  const guardarEquiposAction = async () => {
    if (!equiposPartido) return
    setEquiposLoading(true)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'guardar', partido_id: equiposPartido.id, equipoA, equipoB }) })
    const data = await res.json()
    if (res.ok) { flash(data.mensaje ?? 'Guardado.'); setEquiposDraft(false) }
    else flash(`Error: ${data.error}`)
    setEquiposLoading(false)
  }

  const confirmarEquiposAction = async () => {
    if (!equiposPartido || !confirm('¿Confirmar equipos y notificar a los jugadores?')) return
    setEquiposLoading(true)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'confirmar', partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) { flash(data.mensaje ?? 'Confirmado.'); setEquiposConfirmado(true); await cargarDatos() }
    else flash(`Error: ${data.error}`)
    setEquiposLoading(false)
  }

  const resetearEquiposAction = async () => {
    if (!equiposPartido || !confirm('¿Eliminar los equipos de este partido?')) return
    setEquiposLoading(true)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'resetear', partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) { flash(data.mensaje ?? 'Reseteado.'); setEquipoA([]); setEquipoB([]); setEquiposConfirmado(false); setEquiposDraft(false); await cargarDatos() }
    else flash(`Error: ${data.error}`)
    setEquiposLoading(false)
  }

  const abrirEvaluacionesAction = async () => {
    if (!equiposPartido) return
    const ok = await accionAdmin('abrir_evaluaciones', { partido_id: equiposPartido.id })
    if (ok) { setEvaluacionesAbiertas(true); setEquiposPartido(prev => prev ? { ...prev, evaluaciones_abiertas: true } : prev) }
  }

  const cerrarEvaluacionesAction = async () => {
    if (!equiposPartido || !confirm('¿Cerrar evaluaciones y calcular badges?')) return
    const res = await fetch('/api/evaluaciones', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) { flash(data.mensaje ?? 'Evaluaciones cerradas.'); setEvaluacionesAbiertas(false); setEquiposPartido(prev => prev ? { ...prev, evaluaciones_abiertas: false } : prev); await cargarDatos() }
    else flash(`Error: ${data.error}`)
  }

  const guardarResultadoAction = async () => {
    if (!equiposPartido || !equiposResultado.trim()) return
    const ok = await accionAdmin('registrar_resultado', { partido_id: equiposPartido.id, resultado: equiposResultado.trim() })
    if (ok) setEquiposPartido(prev => prev ? { ...prev, resultado: equiposResultado.trim() } : prev)
  }

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

  const confirmarInvitado = async (invitadoId: string) => {
    setConfirmandoInvitado(invitadoId)
    const res = await fetch('/api/invitados', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitado_id: invitadoId }),
    })
    const data = await res.json()
    if (res.ok) {
      setInvitados(prev => prev.map(inv =>
        inv.id === invitadoId ? { ...inv, estado: 'confirmado', posicion_espera: null } : inv
      ))
      flash(data.mensaje ?? 'Invitado confirmado.')
    } else {
      flash(`Error: ${data.error}`)
    }
    setConfirmandoInvitado(null)
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

  const activeDragPlayer = [...equipoA, ...equipoB].find(p => p.id === activeDragId) ?? null

  const pendientes = players.filter(p => !p.aprobado && !p.baneado && p.role !== 'admin')
  const baneados = players.filter(p => p.baneado && p.role !== 'admin')
  const activos = players
    .filter(p => p.aprobado && !p.baneado)
    .sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1))

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

        {/* ── Access Requests — always visible on any tab ── */}
        {pendientes.length > 0 && (
          <div className="fade-in" style={{
            background: '#130f00',
            border: '1px solid #5a4200',
            borderRadius: 6,
            padding: '18px 20px',
            marginBottom: 36,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🔔</span>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--amber)' }}>
                SOLICITUDES DE ACCESO — {pendientes.length}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pendientes.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', background: 'var(--bg-card)',
                  border: '1px solid #3a2800', borderRadius: 4,
                  flexWrap: 'wrap', gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <PlayerAvatar url={p.avatar_url} username={p.username} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>{p.username}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                        {p.email}
                        {p.ip_registro && <span style={{ marginLeft: 6 }}>· {p.ip_registro}</span>}
                        <span style={{ marginLeft: 6 }}>· {new Date(p.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => accionAdmin('aprobar_jugador', { player_id: p.id })}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '8px 18px', color: 'var(--green)', borderColor: '#16a34a' }}
                    >
                      ✓ Aprobar
                    </button>
                    <button
                      onClick={() => { if (confirm(`¿Rechazar y eliminar la solicitud de ${p.username}?`)) accionAdmin('rechazar_jugador', { player_id: p.id }) }}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '8px 14px', color: 'var(--red)', borderColor: '#7f1d1d' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 40, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {(['partidos', 'equipos', 'jugadores', 'notifs', 'log'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="mono" style={{
              padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1,
              position: 'relative',
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
                                border: `1px solid ${inv.estado === 'confirmado' ? '#16a34a' : '#1a2a3a'}`, borderRadius: 3,
                                gap: 10,
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                  <span className={`badge ${inv.estado === 'confirmado' ? 'badge-green' : 'badge-amber'}`}>
                                    {inv.estado === 'confirmado' ? '✓' : `#${inv.posicion_espera}`}
                                  </span>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 14 }}>{inv.nombre}</div>
                                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>inv. de {inv.profiles.username}</div>
                                  </div>
                                </div>
                                {inv.estado === 'espera' ? (
                                  <button
                                    onClick={() => confirmarInvitado(inv.id)}
                                    disabled={confirmandoInvitado === inv.id}
                                    className="btn btn-ghost"
                                    style={{ fontSize: 11, padding: '6px 12px', color: 'var(--green)', borderColor: '#16a34a', flexShrink: 0 }}
                                  >
                                    {confirmandoInvitado === inv.id ? '...' : '✓ Confirmar'}
                                  </button>
                                ) : (
                                  <span className="mono" style={{ fontSize: 10, color: 'var(--green)', letterSpacing: '0.08em', flexShrink: 0 }}>CONFIRMADO</span>
                                )}
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

        {/* TAB: EQUIPOS */}
        {tab === 'equipos' && (
          <div className="fade-in">
            {/* Match selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>PARTIDO</div>
              <select
                value={equiposPartido?.id ?? ''}
                onChange={e => { const p = partidos.find(pt => pt.id === e.target.value); if (p) cargarEquipos(p) }}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '8px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}
              >
                <option value="">Seleccionar partido...</option>
                {partidos.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.dia_semana} {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                    {p.equipos_confirmados ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </div>

            {!equiposPartido ? (
              <div className="card" style={{ textAlign: 'center', padding: 48 }}>
                <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Selecciona un partido para gestionar los equipos.</p>
              </div>
            ) : equiposLoading ? (
              <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Cargando...</div>
            ) : (
              <>
                {/* Status row */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                  {equiposConfirmado && <span className="badge badge-green">✓ EQUIPOS CONFIRMADOS</span>}
                  {evaluacionesAbiertas && <span className="badge badge-amber">📊 EVALUACIONES ABIERTAS</span>}
                  {equiposDraft && !equiposConfirmado && (
                    <span className="mono" style={{ fontSize: 10, color: 'var(--amber)', letterSpacing: '0.1em' }}>● BORRADOR SIN GUARDAR</span>
                  )}
                </div>

                {/* Skill balance */}
                {(equipoA.length > 0 || equipoB.length > 0) && (() => {
                  const avgA = equipoA.length ? equipoA.reduce((s, p) => s + p.habilidad, 0) / equipoA.length : 0
                  const avgB = equipoB.length ? equipoB.reduce((s, p) => s + p.habilidad, 0) / equipoB.length : 0
                  const diff = Math.abs(avgA - avgB)
                  return (
                    <div className="card" style={{ padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>EQUIPO A</div>
                        <div className="display" style={{ fontSize: 22, color: 'var(--green)' }}>★{avgA.toFixed(1)}</div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{equipoA.length} jugadores</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: diff <= 0.3 ? 'var(--green)' : diff <= 0.6 ? 'var(--amber)' : 'var(--red)' }}>
                          {diff <= 0.3 ? 'EQUILIBRADO' : diff <= 0.6 ? 'LEVE DIF.' : 'DESBAL.'}
                        </div>
                        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Δ {diff.toFixed(1)}</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>EQUIPO B</div>
                        <div className="display" style={{ fontSize: 22, color: 'var(--amber)' }}>★{avgB.toFixed(1)}</div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{equipoB.length} jugadores</div>
                      </div>
                    </div>
                  )
                })()}

                {/* DnD columns */}
                <DndContext sensors={sensors} onDragStart={e => setActiveDragId(e.active.id as string)} onDragEnd={handleDragEnd}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                    <div>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--green)', marginBottom: 8 }}>EQUIPO A — {equipoA.length}</div>
                      <DroppableZone equipo="A" isConfirmado={equiposConfirmado}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {equipoA.map(p => <DraggablePlayerCard key={p.id} jugador={p} equipo="A" confirmado={equiposConfirmado} />)}
                          {equipoA.length === 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0' }}>Arrastra jugadores aquí</div>}
                        </div>
                      </DroppableZone>
                    </div>
                    <div>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--amber)', marginBottom: 8 }}>EQUIPO B — {equipoB.length}</div>
                      <DroppableZone equipo="B" isConfirmado={equiposConfirmado}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {equipoB.map(p => <DraggablePlayerCard key={p.id} jugador={p} equipo="B" confirmado={equiposConfirmado} />)}
                          {equipoB.length === 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0' }}>Arrastra jugadores aquí</div>}
                        </div>
                      </DroppableZone>
                    </div>
                  </div>
                  <DragOverlay>
                    {activeDragPlayer ? (
                      <div style={{ padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--green)', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        <PlayerAvatar url={activeDragPlayer.avatar_url} username={activeDragPlayer.username} size={26} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{activeDragPlayer.username}</div>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{posicionEmoji(activeDragPlayer.posicion)} ★{activeDragPlayer.habilidad.toFixed(1)}</div>
                        </div>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>

                {/* Action buttons */}
                {!equiposConfirmado && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <button onClick={balancearAutomatico} disabled={equiposLoading} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px' }}>
                      ⚖️ Balancear automáticamente
                    </button>
                    <button onClick={guardarEquiposAction} disabled={equiposLoading || !equiposDraft || (equipoA.length + equipoB.length === 0)} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--green)', borderColor: '#16a34a' }}>
                      💾 Guardar borrador
                    </button>
                    <button onClick={confirmarEquiposAction} disabled={equiposLoading || equiposDraft || (equipoA.length + equipoB.length === 0)} className="btn btn-primary" style={{ fontSize: 12, padding: '10px 16px' }}>
                      ✓ Confirmar y notificar
                    </button>
                  </div>
                )}
                <div style={{ marginBottom: 28 }}>
                  <button onClick={resetearEquiposAction} disabled={equiposLoading} className="mono" style={{ fontSize: 11, padding: '8px 14px', background: 'none', border: '1px solid #7f1d1d', borderRadius: 3, color: '#7f1d1d', cursor: 'pointer', letterSpacing: '0.08em' }}>
                    ✕ Resetear equipos
                  </button>
                </div>

                {/* Resultado */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 24 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>RESULTADO DEL PARTIDO</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="text" value={equiposResultado} onChange={e => setEquiposResultado(e.target.value)} placeholder="Ej: 7-5" style={{ width: 100 }} />
                    <button onClick={guardarResultadoAction} disabled={!equiposResultado.trim()} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 14px' }}>
                      Guardar resultado
                    </button>
                    {equiposPartido.resultado && (
                      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        Guardado: <strong style={{ color: 'var(--text)' }}>{equiposPartido.resultado}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Evaluaciones */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>EVALUACIONES ENTRE PARES</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {!evaluacionesAbiertas ? (
                      <button onClick={abrirEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--amber)', borderColor: '#92400e' }}>
                        📊 Abrir evaluaciones
                      </button>
                    ) : (
                      <button onClick={cerrarEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--red)', borderColor: '#7f1d1d' }}>
                        🏅 Cerrar y calcular badges
                      </button>
                    )}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    {evaluacionesAbiertas
                      ? 'Los jugadores pueden evaluar a sus compañeros. Al cerrar, se asignan badges y se actualiza el rating de habilidad.'
                      : 'Al abrir, se envía una notificación push a los jugadores confirmados.'}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB: JUGADORES */}
        {tab === 'jugadores' && (
          <div className="fade-in">

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
                MIEMBROS ACTIVOS — {activos.length}
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
                            {p.role === 'admin' && (
                              <span className="mono" style={{ fontSize: 9, color: 'var(--amber)', letterSpacing: '0.1em', background: '#2d1f00', border: '1px solid #92400e', padding: '2px 5px', borderRadius: 2 }}>ADMIN</span>
                            )}
                            {p.uniform && p.role !== 'admin' && (
                              <span className="mono" style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '0.1em', background: '#0f2d1a', padding: '2px 5px', borderRadius: 2 }}>UNIFORME</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Right: icons + edit — hidden for other admins */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                        {p.role !== 'admin' && (
                          <>
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
                          </>
                        )}
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

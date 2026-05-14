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
  MeasuringStrategy,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { posicionEmoji } from '@/lib/teamBalancer'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { colorLabel, MSG } from '@/lib/design'

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
  hora?: string
  cupos_total: number
  hora_apertura?: string
  dias_antes_apertura?: number
  inscripciones: { estado: string }[]
  invitados: { estado: string }[]
  evaluaciones_abiertas?: boolean
  equipos_confirmados?: boolean
  resultado?: string | null
  goles_a?: number | null
  goles_b?: number | null
  notif_apertura_sent?: boolean
}

interface HistorialPartido {
  id: string
  fecha: string
  dia_semana: string
  resultado: string | null
  goles_a: number | null
  goles_b: number | null
  equipos_confirmados: boolean
  cupos_total: number
  inscripciones: { estado: string }[]
  player_badges: { badge_emoji: string; badge_nombre: string; profiles: { username: string } | null }[]
}

export default function AdminPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'partidos' | 'equipos' | 'jugadores' | 'notifs' | 'cartas' | 'log' | 'historial' | 'ajustes'>('partidos')
  const [cartas, setCartas] = useState<Record<string, unknown>[]>([])
  const [cartasLoading, setCartasLoading] = useState(false)
  const [cartasError, setCartasError] = useState<string | null>(null)
  const [cartaNotas, setCartaNotas] = useState<Record<string, string>>({})
  const [cartaOverrides, setCartaOverrides] = useState<Record<string, Record<string, number>>>({})
  const [cartaActioning, setCartaActioning] = useState<string | null>(null)
  const [authed, setAuthed] = useState<boolean | null>(null)
  // App settings (ajustes tab)
  const [settings, setSettings] = useState<Record<string, boolean>>({
    notif_apertura: true,
    notif_recordatorio: true,
    notif_cupos: true,
    notif_invitados: true,
  })
  const [settingsLoading, setSettingsLoading] = useState(false)
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

  // Modal crear/editar partido
  const [crearModal, setCrearModal] = useState(false)
  const [editPartidoModal, setEditPartidoModal] = useState<Partido | null>(null)
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [nuevaHora, setNuevaHora] = useState('19:00')
  const [nuevosCupos, setNuevosCupos] = useState('14')
  const [nuevaHoraApertura, setNuevaHoraApertura] = useState('10:00')
  const [nuevosDiasAntes, setNuevosDiasAntes] = useState('2')

  // Historial tab
  const [historial, setHistorial] = useState<HistorialPartido[]>([])
  const [historialLoading, setHistorialLoading] = useState(false)

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
  const [golesA, setGolesA] = useState('')
  const [golesB, setGolesB] = useState('')
  const [evaluacionesAbiertas, setEvaluacionesAbiertas] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  // Rotation state
  interface RotacionEquipo {
    equipo_id: string
    color: 'blanco' | 'negro'
    porteroFijo: boolean
    porteroFijoId: string   // username of fixed goalie (empty = not selected)
    rotacionBanca: string[]
    rotacionPortero: string[]
  }
  const [rotacionA, setRotacionA] = useState<RotacionEquipo | null>(null)
  const [rotacionB, setRotacionB] = useState<RotacionEquipo | null>(null)
  const [savingRotacion, setSavingRotacion] = useState(false)

  const [balancerRazon, setBalancerRazon] = useState('')
  const [balancerSource, setBalancerSource] = useState<'gemini' | 'fallback' | null>(null)
  const [balancerFallbackReason, setBalancerFallbackReason] = useState('')

  // Feedback loop
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackHistory, setFeedbackHistory] = useState<{ id: string; feedback: string; created_at: string }[]>([])
  const [savingFeedback, setSavingFeedback] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  // Test push
  const [pushTitle, setPushTitle] = useState('MBA FC')
  const [pushBody, setPushBody] = useState('¡Hay cupo en el partido! Entra a inscribirte ⚽')
  const [pushTarget, setPushTarget] = useState('')
  const [pushGroup, setPushGroup] = useState<'todos' | 'admins' | 'confirmados' | 'espera' | 'todos_partido' | 'individual'>('todos')
  const [pushPartidoId, setPushPartidoId] = useState('')
  const [pushSending, setPushSending] = useState(false)
  const [testEmailAddr, setTestEmailAddr] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; msg: string } | null>(null)

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
      .select('id, fecha, dia_semana, hora, cupos_total, hora_apertura, dias_antes_apertura, inscripciones(estado), invitados(estado), evaluaciones_abiertas, equipos_confirmados, resultado, goles_a, goles_b, notif_apertura_sent')
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

  const cargarCartas = useCallback(async () => {
    setCartasLoading(true)
    setCartasError(null)
    try {
      const res = await fetch('/api/admin?accion=cartas')
      const json = await res.json()
      if (res.ok) {
        setCartas((json.cartas as Record<string, unknown>[]) ?? [])
      } else {
        setCartasError(`Error ${res.status}: ${json.error ?? 'desconocido'}`)
      }
    } catch (e) {
      setCartasError(String(e))
    }
    setCartasLoading(false)
  }, [])

  const cargarSettings = useCallback(async () => {
    setSettingsLoading(true)
    const res = await fetch('/api/admin?accion=settings')
    if (res.ok) {
      const json = await res.json()
      setSettings(json.settings ?? {})
    }
    setSettingsLoading(false)
  }, [])

  const toggleSetting = async (key: string, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'guardar_setting', key, value }),
    })
  }

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
    // Pre-fill goles inputs from existing goles_a / goles_b or parse resultado "N-M"
    if (partido.goles_a != null && partido.goles_b != null) {
      setGolesA(String(partido.goles_a))
      setGolesB(String(partido.goles_b))
    } else if (partido.resultado) {
      const m = partido.resultado.match(/^(\d+)-(\d+)$/)
      if (m) { setGolesA(m[1]); setGolesB(m[2]) }
      else { setGolesA(''); setGolesB('') }
    } else { setGolesA(''); setGolesB('') }
    setEquiposDraft(false)
    const res = await fetch(`/api/equipos?partido_id=${partido.id}`)
    const data = await res.json()
    if (data.equipos) {
      const ea = data.equipos.find((e: { nombre: string }) => e.nombre === 'A')
      const eb = data.equipos.find((e: { nombre: string }) => e.nombre === 'B')
      setEquipoA(ea?.jugadores ?? [])
      setEquipoB(eb?.jugadores ?? [])
      setRotacionA(ea ? {
        equipo_id: ea.id,
        color: ea.color ?? 'blanco',
        porteroFijo: ea.portero_fijo ?? false,
        porteroFijoId: ea.portero_fijo_id ?? '',
        rotacionBanca: ea.rotacion_banca ?? [],
        rotacionPortero: ea.rotacion_portero ?? [],
      } : null)
      setRotacionB(eb ? {
        equipo_id: eb.id,
        color: eb.color ?? 'negro',
        porteroFijo: eb.portero_fijo ?? false,
        porteroFijoId: eb.portero_fijo_id ?? '',
        rotacionBanca: eb.rotacion_banca ?? [],
        rotacionPortero: eb.rotacion_portero ?? [],
      } : null)
    } else {
      setEquipoA([])
      setEquipoB([])
      setRotacionA(null)
      setRotacionB(null)
    }
    setEquiposLoading(false)
  }, [])

  const cargarFeedback = useCallback(async () => {
    const res = await fetch('/api/balancer-feedback')
    if (res.ok) {
      const data = await res.json()
      setFeedbackHistory(data.feedback ?? [])
    }
  }, [])

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const aleatorizarRotacion = (equipo: 'A' | 'B') => {
    const jugadores = equipo === 'A' ? equipoA : equipoB
    const setter = equipo === 'A' ? setRotacionA : setRotacionB
    setter(prev => {
      if (!prev) return prev
      const allUsernames = jugadores.map(j => j.username)
      // Exclude fixed goalie from bench rotation
      const goalie = prev.porteroFijo ? prev.porteroFijoId : ''
      const fieldPlayers = goalie ? allUsernames.filter(u => u !== goalie) : allUsernames
      return {
        ...prev,
        rotacionBanca: shuffleArray(fieldPlayers),
        // If portero fijo, no goalie rotation needed
        rotacionPortero: prev.porteroFijo ? [] : shuffleArray(allUsernames),
      }
    })
  }

  const swapColores = () => {
    setRotacionA(prev => prev ? { ...prev, color: prev.color === 'blanco' ? 'negro' : 'blanco' } : prev)
    setRotacionB(prev => prev ? { ...prev, color: prev.color === 'blanco' ? 'negro' : 'blanco' } : prev)
  }

  const guardarRotaciones = async () => {
    if (!equiposPartido || !rotacionA || !rotacionB) return
    setSavingRotacion(true)
    const res = await fetch('/api/equipos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accion: 'guardar_rotacion',
        partido_id: equiposPartido.id,
        rotaciones: [
          { equipo_id: rotacionA.equipo_id, color: rotacionA.color, portero_fijo: rotacionA.porteroFijo, portero_fijo_id: rotacionA.porteroFijoId || null, rotacion_banca: rotacionA.rotacionBanca, rotacion_portero: rotacionA.rotacionPortero },
          { equipo_id: rotacionB.equipo_id, color: rotacionB.color, portero_fijo: rotacionB.porteroFijo, portero_fijo_id: rotacionB.porteroFijoId || null, rotacion_banca: rotacionB.rotacionBanca, rotacion_portero: rotacionB.rotacionPortero },
        ],
      }),
    })
    const data = await res.json()
    if (res.ok) flash(data.mensaje ?? 'Rotaciones guardadas.')
    else flash(`Error: ${data.error}`)
    setSavingRotacion(false)
  }

  const guardarFeedback = async () => {
    if (!feedbackText.trim()) return
    setSavingFeedback(true)
    const res = await fetch('/api/balancer-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: feedbackText.trim() }),
    })
    if (res.ok) {
      setFeedbackText('')
      await cargarFeedback()
      flash('Feedback guardado. Se usará en el próximo balanceo.')
    } else {
      const data = await res.json()
      flash(`Error: ${data.error}`)
    }
    setSavingFeedback(false)
  }

  const eliminarFeedback = async (id: string) => {
    const res = await fetch('/api/balancer-feedback', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) await cargarFeedback()
  }

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
    setBalancerRazon('')
    setBalancerSource(null)
    setBalancerFallbackReason('')
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'balancear', partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) {
      setEquipoA(data.equipoA ?? [])
      setEquipoB(data.equipoB ?? [])
      setEquiposDraft(true)
      setBalancerRazon(data.razon ?? '')
      setBalancerSource(data.source ?? 'fallback')
      setBalancerFallbackReason(data.fallbackReason ?? '')
    } else {
      flash(`Error: ${data.error}`)
    }
    setEquiposLoading(false)
  }

  const guardarEquiposAction = async () => {
    if (!equiposPartido) return
    setEquiposLoading(true)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'guardar', partido_id: equiposPartido.id, equipoA, equipoB }) })
    const data = await res.json()
    if (res.ok) {
      flash(data.mensaje ?? 'Guardado.')
      setEquiposDraft(false)
      // Hide balancer/context sections after saving
      setBalancerSource(null)
      setBalancerRazon('')
      setBalancerFallbackReason('')
      // Reload to get fresh equipo IDs (old rows deleted, new ones created) → rotation section appears
      await cargarEquipos(equiposPartido)
    } else {
      flash(`Error: ${data.error}`)
    }
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

  const reabrirEvaluacionesAction = async () => {
    if (!equiposPartido || !confirm('¿Reabrir evaluaciones? Los badges asignados de este partido se eliminarán y se recalcularán al cerrar de nuevo.')) return
    const res = await fetch('/api/evaluaciones', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) { flash(data.mensaje ?? 'Evaluaciones reabiertas.'); setEvaluacionesAbiertas(true); setEquiposPartido(prev => prev ? { ...prev, evaluaciones_abiertas: true } : prev) }
    else flash(`Error: ${data.error}`)
  }

  const guardarResultadoAction = async () => {
    if (!equiposPartido) return
    const gA = parseInt(golesA)
    const gB = parseInt(golesB)
    if (isNaN(gA) || isNaN(gB) || gA < 0 || gB < 0) return
    const resultado = `${gA}-${gB}`
    const ok = await accionAdmin('registrar_resultado', { partido_id: equiposPartido.id, goles_a: String(gA), goles_b: String(gB) })
    if (ok) {
      setEquiposPartido(prev => prev ? { ...prev, resultado, goles_a: gA, goles_b: gB } : prev)
      setEquiposResultado(resultado)
    }
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

  useEffect(() => {
    if (tab === 'cartas') cargarCartas()
  }, [tab, cargarCartas])

  useEffect(() => {
    if (tab === 'equipos') cargarFeedback()
  }, [tab, cargarFeedback])

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

  const confirmarInvitado = async (invitadoId: string, remove = false) => {
    if (remove) {
      if (!confirm('¿Remover este invitado confirmado?')) return
      const res = await fetch('/api/invitados', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitado_id: invitadoId }),
      })
      if (res.ok) {
        setInvitados(prev => prev.filter(inv => inv.id !== invitadoId))
        flash('Invitado removido.')
      } else {
        const data = await res.json()
        flash(`Error: ${data.error}`)
      }
      return
    }
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
    await accionAdmin('editar_jugador', { player_id: editModal.id, email: editEmail })
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

  const abrirEditPartido = (p: Partido) => {
    setEditPartidoModal(p)
    setNuevaFecha(p.fecha)
    setNuevaHora(p.hora?.substring(0, 5) ?? '19:00')
    setNuevosCupos(String(p.cupos_total))
    setNuevaHoraApertura(p.hora_apertura?.substring(0, 5) ?? '10:00')
    setNuevosDiasAntes(String(p.dias_antes_apertura ?? 2))
  }

  const editarPartido = async () => {
    if (!editPartidoModal || !nuevaFecha) return
    const ok = await accionAdmin('editar_partido', {
      partido_id: editPartidoModal.id,
      fecha: nuevaFecha,
      hora: nuevaHora + ':00',
      cupos_total: nuevosCupos,
      hora_apertura: nuevaHoraApertura + ':00',
      dias_antes_apertura: nuevosDiasAntes,
    })
    if (ok) {
      setEditPartidoModal(null)
      await cargarDatos()
    }
  }

  const eliminarPartido = async (partidoId: string) => {
    const ok = await accionAdmin('eliminar_partido', { partido_id: partidoId })
    if (ok) {
      setPartidos(prev => prev.filter(p => p.id !== partidoId))
      if (selectedPartido === partidoId) setSelectedPartido(null)
    }
  }

  const cargarHistorial = useCallback(async () => {
    setHistorialLoading(true)
    const hoy = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana, resultado, goles_a, goles_b, equipos_confirmados, cupos_total, inscripciones(estado), player_badges(badge_emoji, badge_nombre, profiles!player_badges_player_id_fkey(username))')
      .lt('fecha', hoy)
      .order('fecha', { ascending: false })
      .limit(30)
    setHistorial((data as unknown as HistorialPartido[]) ?? [])
    setHistorialLoading(false)
  }, [supabase])

  // Must be after cargarHistorial is declared
  useEffect(() => {
    if (tab === 'historial') cargarHistorial()
  }, [tab, cargarHistorial])

  useEffect(() => {
    if (tab === 'ajustes') cargarSettings()
  }, [tab, cargarSettings])

  const enviarPushTest = async () => {
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
    setMensaje(data.mensaje ?? data.error ?? 'Error desconocido')
    setTimeout(() => setMensaje(''), 8000)
    setPushSending(false)
  }

  const enviarEmailPrueba = async () => {
    if (!testEmailAddr) return
    setTestEmailSending(true)
    setTestEmailResult(null)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'enviar_email_prueba', email: testEmailAddr }),
    })
    const data = await res.json()
    setTestEmailResult({ ok: res.ok, msg: data.mensaje ?? data.error ?? 'Error desconocido' })
    setTestEmailSending(false)
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
            ...(mensaje.startsWith('Error') ? MSG.error : MSG.ok),
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

        {/* Utility icon bar — separate from main tabs */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 8 }}>
          {([
            { id: 'ajustes',  icon: '⚙',  title: 'Configuración' },
            { id: 'historial', icon: '🕐', title: 'Historial' },
            { id: 'notifs',   icon: '🔔', title: 'Notificaciones' },
          ] as const).map(({ id, icon, title }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={title}
              className="mono"
              style={{
                padding: '7px 13px', borderRadius: 6,
                background: tab === id ? 'var(--bg-card)' : 'none',
                border: tab === id ? '1px solid var(--border)' : '1px solid transparent',
                cursor: 'pointer', fontSize: 16,
                opacity: tab === id ? 1 : 0.4,
                transition: 'opacity 0.15s, background 0.15s',
              }}
            >
              {icon}
            </button>
          ))}
        </div>

        {/* Main text tabs */}
        <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 40, borderBottom: '1px solid var(--border)' }}>
          {(['partidos', 'equipos', 'jugadores', 'cartas', 'log'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="mono" style={{
              padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1, position: 'relative',
            }}>
              {t === 'cartas' && cartas.filter(c => !c.aprobado && !c.rechazado).length > 0
                ? `cartas (${cartas.filter(c => !c.aprobado && !c.rechazado).length})`
                : t}
            </button>
          ))}
        </div>

        {/* TAB: PARTIDOS */}
        {tab === 'partidos' && (
          <div id="tab-partidos" className="fade-in">
            <div className="admin-partidos-grid">

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
                    const cupos = p.cupos_total ?? 14
                    // For the selected partido, derive counts from the live inscripciones/invitados state
                    // (refreshed after every EN ESPERA / REMOVER action). For others, compute from estado rows.
                    let confirmados: number
                    let espera: number
                    if (p.id === selectedPartido) {
                      confirmados = inscripciones.filter(i => i.estado === 'confirmado').length
                        + invitados.filter(i => i.estado === 'confirmado').length
                      espera = inscripciones.filter(i => i.estado === 'espera').length
                    } else {
                      const rows = p.inscripciones ?? []
                      const invRows = p.invitados ?? []
                      confirmados = rows.filter((r: { estado: string }) => r.estado === 'confirmado').length
                        + invRows.filter((r: { estado: string }) => r.estado === 'confirmado').length
                      espera = rows.filter((r: { estado: string }) => r.estado === 'espera').length
                    }
                    return (
                      <div key={p.id} style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                        <button onClick={() => setSelectedPartido(p.id)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
                              <span style={{ color: confirmados >= cupos ? 'var(--red)' : 'var(--green)' }}>{confirmados}</span>
                              <span style={{ color: 'var(--text-dim)' }}>/{cupos}</span>
                            </div>
                            {espera > 0 && (
                              <div className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>+{espera} espera</div>
                            )}
                            <div className="mono" style={{ fontSize: 9, color: p.notif_apertura_sent ? 'var(--green)' : 'var(--text-dim)', marginTop: 2 }}>
                              {p.notif_apertura_sent ? '🔔 notif ✓' : '🔕 notif pendiente'}
                            </div>
                          </div>
                        </button>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button
                            onClick={() => abrirEditPartido(p)}
                            title="Editar partido"
                            style={{ flex: 1, padding: '0 10px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}
                          >✏</button>
                          <button
                            onClick={() => { if (window.confirm(`¿Eliminar partido del ${p.dia_semana} ${p.fecha}? Esta acción no se puede deshacer.`)) eliminarPartido(p.id) }}
                            title="Eliminar partido"
                            style={{ flex: 1, padding: '0 10px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--red)', fontSize: 14 }}
                          >✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Inscripciones del partido seleccionado */}
              <div>
                {selectedPartido ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                        INSCRITOS
                      </div>
                      {(() => {
                        const p = partidos.find(x => x.id === selectedPartido)
                        if (!p || p.notif_apertura_sent) return null
                        return (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 10, padding: '4px 10px', color: 'var(--amber)', borderColor: '#92400e' }}
                            onClick={async () => {
                              const ok = await accionAdmin('forzar_notif_apertura', { partido_id: selectedPartido })
                              if (ok) setPartidos(prev => prev.map(x => x.id === selectedPartido ? { ...x, notif_apertura_sent: true } : x))
                            }}
                          >
                            🔔 Forzar notif apertura
                          </button>
                        )
                      })()}
                    </div>
                    {inscripciones.length === 0 ? (
                      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
                        <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin inscripciones aún.</p>
                      </div>
                    ) : (
                      <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {/* Confirmed players (inscripciones) */}
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
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              {ins.estado === 'confirmado' && (
                                <button
                                  onClick={() => accionAdmin('mover_espera', { player_id: ins.profiles.id, partido_id: ins.partido_id })}
                                  className="mono"
                                  style={{ fontSize: 11, color: 'var(--amber)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}
                                >
                                  EN ESPERA
                                </button>
                              )}
                              <button
                                onClick={() => accionAdmin('remover_partido', { player_id: ins.profiles.id, partido_id: ins.partido_id })}
                                className="mono"
                                style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}
                              >
                                REMOVER
                              </button>
                            </div>
                          </div>
                        ))}
                        {/* Confirmed invitados — shown inline with inscripciones */}
                        {invitados.filter(inv => inv.estado === 'confirmado').map(inv => (
                          <div key={inv.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 14px', background: 'var(--bg-card)',
                            border: '1px solid #16a34a', borderRadius: 3
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span className="badge badge-green">✓</span>
                              <div>
                                <div style={{ fontSize: 15 }}>{inv.nombre}</div>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>inv. de {inv.profiles.username}</div>
                              </div>
                            </div>
                            <button
                              onClick={() => confirmarInvitado(inv.id, true)}
                              className="mono"
                              style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}
                            >
                              REMOVER
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Espera invitados — confirm button */}
                      {invitados.some(inv => inv.estado === 'espera') && (
                        <div style={{ marginTop: 20 }}>
                          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>
                            INVITADOS EN ESPERA — {invitados.filter(inv => inv.estado === 'espera').length}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {invitados.filter(inv => inv.estado === 'espera').map(inv => (
                              <div key={inv.id} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '10px 14px', background: 'var(--bg-card)',
                                border: '1px solid #1a2a3a', borderRadius: 3,
                                gap: 10,
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                  <span className="badge badge-amber">{`#${inv.posicion_espera}`}</span>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 14 }}>{inv.nombre}</div>
                                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>inv. de {inv.profiles.username}</div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => confirmarInvitado(inv.id)}
                                  disabled={confirmandoInvitado === inv.id}
                                  className="btn btn-ghost"
                                  style={{ fontSize: 11, padding: '6px 12px', color: 'var(--green)', borderColor: '#16a34a', flexShrink: 0 }}
                                >
                                  {confirmandoInvitado === inv.id ? '...' : '✓ Confirmar'}
                                </button>
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
          <div id="tab-equipos" className="fade-in">
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
                <DndContext sensors={sensors} measuring={{ draggable: { measure: (node) => node.getBoundingClientRect() }, droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={e => setActiveDragId(e.active.id as string)} onDragEnd={handleDragEnd}>
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
                  <div id="admin-equipos-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <button id="btn-balancear" onClick={balancearAutomatico} disabled={equiposLoading} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px' }}>
                      ⚖️ Balancear automáticamente
                    </button>
                    <button id="btn-guardar-borrador" onClick={guardarEquiposAction} disabled={equiposLoading || !equiposDraft || (equipoA.length + equipoB.length === 0)} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--green)', borderColor: '#16a34a' }}>
                      💾 Guardar borrador
                    </button>
                    <button id="btn-confirmar-equipos" onClick={confirmarEquiposAction} disabled={equiposLoading || equiposDraft || (equipoA.length + equipoB.length === 0)} className="btn btn-primary" style={{ fontSize: 12, padding: '10px 16px' }}>
                      ✓ Confirmar y notificar
                    </button>
                  </div>
                )}
                <div style={{ marginBottom: 28 }}>
                  <button id="btn-resetear-equipos" onClick={resetearEquiposAction} disabled={equiposLoading} className="mono" style={{ fontSize: 11, padding: '8px 14px', background: 'none', border: '1px solid #7f1d1d', borderRadius: 3, color: '#7f1d1d', cursor: 'pointer', letterSpacing: '0.08em' }}>
                    ✕ Resetear equipos
                  </button>
                </div>

                {/* ── COLORES + ROTACIONES ───────────────────────────── */}
                {(rotacionA || rotacionB) && (
                  <div id="admin-rotaciones" style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>
                        ⚽ COLORES Y ROTACIONES
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={swapColores} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>
                          ↔ Cambiar colores
                        </button>
                        <button
                          onClick={() => { aleatorizarRotacion('A'); aleatorizarRotacion('B') }}
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '6px 12px', color: 'var(--amber)', borderColor: '#92400e' }}
                        >
                          🎲 Aleatorizar rotaciones
                        </button>
                        <button
                          onClick={guardarRotaciones}
                          disabled={savingRotacion}
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '6px 12px', color: 'var(--green)', borderColor: '#16a34a' }}
                        >
                          {savingRotacion ? '...' : '💾 Guardar'}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* ── EQUIPO A ── */}
                      {rotacionA && (() => {
                        const accentA = 'var(--green)'
                        const jugadoresA = equipoA.map(j => j.username)
                        return (
                          <div>
                            {/* Header: name + color badge */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: accentA }}>EQUIPO A</div>
                              <span style={{
                                fontSize: 11, padding: '2px 8px', borderRadius: 2,
                                background: rotacionA.color === 'blanco' ? '#e5e5e5' : '#1a1a1a',
                                color: rotacionA.color === 'blanco' ? '#111' : '#aaa',
                                border: `1px solid ${rotacionA.color === 'blanco' ? '#ccc' : '#444'}`,
                                fontFamily: 'DM Mono, monospace',
                              }}>
                                {colorLabel(rotacionA.color)}
                              </span>
                            </div>

                            {/* Portero fijo toggle + goalie picker */}
                            <div style={{ marginBottom: 14 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={rotacionA.porteroFijo}
                                  onChange={e => setRotacionA(p => p ? { ...p, porteroFijo: e.target.checked, porteroFijoId: '' } : p)}
                                  style={{ width: 14, height: 14, accentColor: accentA, cursor: 'pointer' }}
                                />
                                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>🧤 Portero fijo</span>
                              </label>
                              {rotacionA.porteroFijo && (
                                <div>
                                  <select
                                    value={rotacionA.porteroFijoId}
                                    onChange={e => {
                                      const g = e.target.value
                                      setRotacionA(p => p ? {
                                        ...p,
                                        porteroFijoId: g,
                                        rotacionBanca: g ? p.rotacionBanca.filter(u => u !== g) : p.rotacionBanca,
                                      } : p)
                                    }}
                                    style={{ fontSize: 12, padding: '6px 10px', marginBottom: 8, width: '100%' }}
                                  >
                                    <option value="">— seleccionar portero —</option>
                                    {jugadoresA.map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                                  {rotacionA.porteroFijoId && (
                                    <div style={{
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      background: '#0a1f0f', border: '1px solid #16a34a',
                                      borderRadius: 4, padding: '8px 12px',
                                    }}>
                                      <span style={{ fontSize: 18 }}>🧤</span>
                                      <div>
                                        <div className="mono" style={{ fontSize: 12, color: accentA, fontWeight: 600 }}>{rotacionA.porteroFijoId}</div>
                                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>portero titular — no rota</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Bench rotation */}
                            {rotacionA.rotacionBanca.length > 0 ? (
                              <div style={{ marginBottom: 12 }}>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>ROTACIÓN BANCA</div>
                                {rotacionA.rotacionBanca.map((u, i) => (
                                  <div key={u} className="mono" style={{ fontSize: 12, color: i === 0 ? 'var(--amber)' : 'var(--text-dim)', padding: '3px 0', display: 'flex', gap: 8 }}>
                                    <span style={{ minWidth: 20, color: 'var(--text-dim)' }}>{i + 1}.</span>
                                    <span>{u}</span>
                                    {i === 0 && <span style={{ fontSize: 10, color: 'var(--amber)' }}>← empieza banca</span>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Presiona 🎲 para generar rotaciones</div>
                            )}

                            {/* Goalie rotation (only if not portero fijo) */}
                            {!rotacionA.porteroFijo && rotacionA.rotacionPortero.length > 0 && (
                              <div>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>ROTACIÓN PORTERO</div>
                                {rotacionA.rotacionPortero.map((u, i) => (
                                  <div key={u} className="mono" style={{ fontSize: 12, color: i === 0 ? accentA : 'var(--text-dim)', padding: '3px 0', display: 'flex', gap: 8 }}>
                                    <span style={{ minWidth: 20, color: 'var(--text-dim)' }}>{i + 1}.</span>
                                    <span>{u}</span>
                                    {i === 0 && <span style={{ fontSize: 10, color: accentA }}>← primer portero</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}

                      {/* ── EQUIPO B ── */}
                      {rotacionB && (() => {
                        const accentB = 'var(--amber)'
                        const jugadoresB = equipoB.map(j => j.username)
                        return (
                          <div>
                            {/* Header: name + color badge */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: accentB }}>EQUIPO B</div>
                              <span style={{
                                fontSize: 11, padding: '2px 8px', borderRadius: 2,
                                background: rotacionB.color === 'blanco' ? '#e5e5e5' : '#1a1a1a',
                                color: rotacionB.color === 'blanco' ? '#111' : '#aaa',
                                border: `1px solid ${rotacionB.color === 'blanco' ? '#ccc' : '#444'}`,
                                fontFamily: 'DM Mono, monospace',
                              }}>
                                {colorLabel(rotacionB.color)}
                              </span>
                            </div>

                            {/* Portero fijo toggle + goalie picker */}
                            <div style={{ marginBottom: 14 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={rotacionB.porteroFijo}
                                  onChange={e => setRotacionB(p => p ? { ...p, porteroFijo: e.target.checked, porteroFijoId: '' } : p)}
                                  style={{ width: 14, height: 14, accentColor: accentB, cursor: 'pointer' }}
                                />
                                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>🧤 Portero fijo</span>
                              </label>
                              {rotacionB.porteroFijo && (
                                <div>
                                  <select
                                    value={rotacionB.porteroFijoId}
                                    onChange={e => {
                                      const g = e.target.value
                                      setRotacionB(p => p ? {
                                        ...p,
                                        porteroFijoId: g,
                                        rotacionBanca: g ? p.rotacionBanca.filter(u => u !== g) : p.rotacionBanca,
                                      } : p)
                                    }}
                                    style={{ fontSize: 12, padding: '6px 10px', marginBottom: 8, width: '100%' }}
                                  >
                                    <option value="">— seleccionar portero —</option>
                                    {jugadoresB.map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                                  {rotacionB.porteroFijoId && (
                                    <div style={{
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      background: '#1a1200', border: '1px solid #92400e',
                                      borderRadius: 4, padding: '8px 12px',
                                    }}>
                                      <span style={{ fontSize: 18 }}>🧤</span>
                                      <div>
                                        <div className="mono" style={{ fontSize: 12, color: accentB, fontWeight: 600 }}>{rotacionB.porteroFijoId}</div>
                                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>portero titular — no rota</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Bench rotation */}
                            {rotacionB.rotacionBanca.length > 0 ? (
                              <div style={{ marginBottom: 12 }}>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>ROTACIÓN BANCA</div>
                                {rotacionB.rotacionBanca.map((u, i) => (
                                  <div key={u} className="mono" style={{ fontSize: 12, color: i === 0 ? accentB : 'var(--text-dim)', padding: '3px 0', display: 'flex', gap: 8 }}>
                                    <span style={{ minWidth: 20, color: 'var(--text-dim)' }}>{i + 1}.</span>
                                    <span>{u}</span>
                                    {i === 0 && <span style={{ fontSize: 10, color: accentB }}>← empieza banca</span>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Presiona 🎲 para generar rotaciones</div>
                            )}

                            {/* Goalie rotation (only if not portero fijo) */}
                            {!rotacionB.porteroFijo && rotacionB.rotacionPortero.length > 0 && (
                              <div>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>ROTACIÓN PORTERO</div>
                                {rotacionB.rotacionPortero.map((u, i) => (
                                  <div key={u} className="mono" style={{ fontSize: 12, color: i === 0 ? accentB : 'var(--text-dim)', padding: '3px 0', display: 'flex', gap: 8 }}>
                                    <span style={{ minWidth: 20, color: 'var(--text-dim)' }}>{i + 1}.</span>
                                    <span>{u}</span>
                                    {i === 0 && <span style={{ fontSize: 10, color: accentB }}>← primer portero</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                )}

                {/* Gemini razon + feedback loop — visible only while draft not yet saved */}
                {balancerSource !== null && <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 24 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>
                    🤖 BALANCEADOR IA
                    {balancerSource === 'gemini' && <span style={{ marginLeft: 8, color: 'var(--green)' }}>· Gemini</span>}
                    {balancerSource === 'fallback' && <span style={{ marginLeft: 8, color: 'var(--amber)' }}>· Snake-draft (fallback){balancerFallbackReason ? ': ' + balancerFallbackReason : ''}</span>}
                  </div>
                  {balancerRazon && (
                    <div style={{
                      background: '#0a1a0f', border: '1px solid #16a34a', borderRadius: 4,
                      padding: '10px 14px', marginBottom: 16, fontSize: 12,
                      color: 'var(--text-dim)', fontStyle: 'italic', lineHeight: 1.6,
                    }}>
                      &ldquo;{balancerRazon}&rdquo;
                    </div>
                  )}

                  {/* Feedback textarea */}
                  <div style={{ marginBottom: 16 }}>
                    <label className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)', display: 'block', marginBottom: 8 }}>
                      FEEDBACK PARA EL PRÓXIMO BALANCEO
                    </label>
                    <textarea
                      value={feedbackText}
                      onChange={e => setFeedbackText(e.target.value)}
                      placeholder={'Ej: "Juli y Mauricio no deben ir juntos, se pelean mucho"\nEj: "Magic y Mati siempre en el mismo equipo (padre e hijo)"'}
                      rows={3}
                      style={{
                        width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 3, padding: '10px 12px', color: 'var(--text)',
                        fontFamily: 'DM Mono, monospace', fontSize: 12, resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                    <button
                      onClick={guardarFeedback}
                      disabled={savingFeedback || !feedbackText.trim()}
                      className="btn btn-ghost"
                      style={{ marginTop: 8, fontSize: 11, padding: '8px 16px', color: 'var(--green)', borderColor: '#16a34a' }}
                    >
                      {savingFeedback ? 'Guardando...' : '💾 Guardar feedback'}
                    </button>
                  </div>

                  {/* Feedback history */}
                  {feedbackHistory.length > 0 && (
                    <div>
                      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 8 }}>
                        CONTEXTO ACUMULADO — {feedbackHistory.length} entradas
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                        {feedbackHistory.map(f => (
                          <div key={f.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '8px 12px', background: 'var(--bg-card)',
                            border: '1px solid var(--border)', borderRadius: 3,
                          }}>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', minWidth: 60, paddingTop: 1 }}>
                              {new Date(f.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                            </div>
                            <div style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{f.feedback}</div>
                            <button
                              onClick={() => eliminarFeedback(f.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7f1d1d', fontSize: 13, lineHeight: 1, flexShrink: 0, padding: '0 4px' }}
                              title="Eliminar"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>}

                {/* Resultado */}
                <div id="admin-resultado" style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 24 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>RESULTADO DEL PARTIDO</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--green)' }}>
                        {rotacionA ? (rotacionA.color === 'blanco' ? '🤍' : '🖤') : 'A'}
                      </span>
                      <input
                        type="number" min={0} max={99}
                        value={golesA}
                        onChange={e => setGolesA(e.target.value)}
                        placeholder="0"
                        style={{ width: 56, textAlign: 'center' }}
                      />
                    </div>
                    <span className="mono" style={{ fontSize: 14, color: 'var(--text-dim)' }}>—</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number" min={0} max={99}
                        value={golesB}
                        onChange={e => setGolesB(e.target.value)}
                        placeholder="0"
                        style={{ width: 56, textAlign: 'center' }}
                      />
                      <span className="mono" style={{ fontSize: 10, color: 'var(--amber)' }}>
                        {rotacionB ? (rotacionB.color === 'blanco' ? '🤍' : '🖤') : 'B'}
                      </span>
                    </div>
                    <button
                      onClick={guardarResultadoAction}
                      disabled={golesA === '' || golesB === ''}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '8px 14px' }}
                    >
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
                <div id="admin-evaluaciones" style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>EVALUACIONES ENTRE PARES</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {!evaluacionesAbiertas ? (
                      <>
                        <button id="btn-abrir-evaluaciones" onClick={abrirEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--amber)', borderColor: '#92400e' }}>
                          📊 Abrir evaluaciones
                        </button>
                        {/* Undo: reopen after accidental close */}
                        {equiposPartido?.evaluaciones_abiertas === false && (
                          <button id="btn-reabrir-evaluaciones" onClick={reabrirEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                            ↩ Reabrir (deshacer cierre)
                          </button>
                        )}
                      </>
                    ) : (
                      <button id="btn-cerrar-evaluaciones" onClick={cerrarEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--red)', borderColor: '#7f1d1d' }}>
                        🏅 Cerrar y calcular badges
                      </button>
                    )}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    {evaluacionesAbiertas
                      ? 'Los jugadores pueden votar reconocimientos. Al cerrar, se asignan badges.'
                      : 'Al abrir, los jugadores confirmados pueden votar reconocimientos entre pares.'}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB: JUGADORES */}
        {tab === 'jugadores' && (
          <div id="tab-jugadores" className="fade-in">

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
          <div id="tab-notifs" className="fade-in" style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: 480 }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 24 }}>
              ENVIAR NOTIFICACIÓN
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Group selector */}
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 10 }}>DESTINATARIOS</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {([
                    { id: 'todos', label: '🌐 Todos' },
                    { id: 'admins', label: '🛡️ Admins' },
                    { id: 'confirmados', label: '✅ Confirmados' },
                    { id: 'espera', label: '⏳ Lista de espera' },
                    { id: 'todos_partido', label: '⚽ Todos del partido' },
                    { id: 'individual', label: '👤 Individual' },
                  ] as { id: typeof pushGroup; label: string }[]).map(g => (
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
                    >{g.label}</button>
                  ))}
                </div>
              </div>

              {/* Partido selector (for match groups) */}
              {['confirmados', 'espera', 'todos_partido'].includes(pushGroup) && (
                <div>
                  <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>PARTIDO</label>
                  <select
                    value={pushPartidoId || partidos[0]?.id || ''}
                    onChange={e => setPushPartidoId(e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}
                  >
                    {partidos.map(p => (
                      <option key={p.id} value={p.id}>{p.dia_semana} {new Date(p.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Individual player selector */}
              {pushGroup === 'individual' && (
                <div>
                  <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>JUGADOR</label>
                  <select value={pushTarget} onChange={e => setPushTarget(e.target.value)} style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>
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
                onClick={enviarPushTest}
                disabled={pushSending || (pushGroup === 'individual' && !pushTarget)}
                className="btn btn-primary"
                style={{ padding: '14px', fontSize: 13 }}
              >
                {pushSending ? 'Enviando...' : 'Enviar notificación'}
              </button>
            </div>

            {/* Auto-notifications info */}
            <div className="card" style={{ marginTop: 32, borderColor: '#1a2a1a' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 12 }}>NOTIFICACIONES AUTOMÁTICAS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  '🙋 Nuevo jugador solicita acceso → Admins',
                  '⚠️ Jugador se retira del partido → Admins',
                  '✅ Jugador promovido de lista de espera → ese jugador (email + push)',
                  '📋 Partido abierto para inscripciones → todos los jugadores',
                  '⏰ Recordatorio antes del partido → confirmados',
                  '🔔 Cupo disponible → lista de espera',
                  '🎭 Tu invitado entró al partido → invitador',
                  '⚽ Equipos confirmados → cada confirmado (su equipo)',
                  '📊 Evaluaciones abiertas → confirmados',
                ].map((item, i) => (
                  <div key={i} className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

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

        {/* TAB: CARTAS */}
        {tab === 'cartas' && (
          <div id="tab-cartas" className="fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                FIFA CARTAS — {cartas.length} enviadas
              </div>
              <button onClick={cargarCartas} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>
                ↻ Refrescar
              </button>
            </div>
            {cartasLoading ? (
              <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Cargando...</div>
            ) : cartasError ? (
              <div className="card" style={{ padding: 24, border: '1px solid var(--red)' }}>
                <p className="mono" style={{ fontSize: 12, color: 'var(--red)' }}>⚠ Error cargando cartas: {cartasError}</p>
                <p className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Revisa la consola del navegador para más detalles.</p>
              </div>
            ) : cartas.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 48 }}>
                <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ningún jugador ha enviado su evaluación aún.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {/* PENDING */}
                {cartas.filter(c => !c.aprobado && !c.rechazado).length > 0 && (
                  <div>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--amber)', marginBottom: 12 }}>
                      ⏳ PENDIENTES ({cartas.filter(c => !c.aprobado && !c.rechazado).length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {cartas.filter(c => !c.aprobado && !c.rechazado).map(carta => {
                        const pid = carta.player_id as string
                        const profile = carta.profiles as { username: string; avatar_url: string | null } | null
                        const overrides = cartaOverrides[pid] ?? {}
                        const STATS = ['res', 'fis', 'def', 'ata', 'tec', 'dis'] as const
                        return (
                          <div key={pid} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <PlayerAvatar url={profile?.avatar_url ?? null} username={profile?.username ?? '?'} size={40} />
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 15 }}>{profile?.username ?? pid}</div>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                                  OVR {carta.ovr as number} · {String(carta.tier).toUpperCase()} · {(carta.posicion_carta as string | null) ?? '—'} · {(carta.pierna as string | null) ?? '—'}
                                </div>
                              </div>
                              <div style={{ marginLeft: 'auto' }}>
                                <span className="mono" style={{
                                  fontSize: 22, fontWeight: 900, color:
                                    (carta.ovr as number) >= 88 ? '#9f7aea' :
                                    (carta.ovr as number) >= 81 ? '#f6993f' :
                                    (carta.ovr as number) >= 74 ? '#f6c90e' :
                                    (carta.ovr as number) >= 67 ? '#a0aec0' :
                                    '#a0856b'
                                }}>
                                  {carta.ovr as number}
                                </span>
                              </div>
                            </div>

                            {/* Stats with override inputs */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                              {STATS.map(stat => {
                                const key = `stat_${stat}` as string
                                const original = carta[key] as number
                                const override = overrides[key]
                                const display = override ?? original
                                return (
                                  <div key={stat} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                                      {stat.toUpperCase()}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: override ? 'var(--amber)' : 'var(--text)', minWidth: 28 }}>
                                        {display}
                                      </span>
                                      <input
                                        type="number"
                                        min={45} max={99}
                                        placeholder="—"
                                        value={override ?? ''}
                                        onChange={e => {
                                          const val = parseInt(e.target.value)
                                          setCartaOverrides(prev => {
                                            const next = { ...prev, [pid]: { ...prev[pid] } }
                                            if (isNaN(val)) {
                                              delete next[pid][key]
                                            } else {
                                              next[pid][key] = Math.min(99, Math.max(45, val))
                                            }
                                            return next
                                          })
                                        }}
                                        style={{
                                          width: 50, padding: '2px 6px', fontSize: 12,
                                          background: 'var(--bg)', border: '1px solid var(--border)',
                                          borderRadius: 3, color: 'var(--text)',
                                          fontFamily: 'monospace',
                                        }}
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            {Object.keys(overrides).length > 0 && (
                              <div className="mono" style={{ fontSize: 10, color: 'var(--amber)' }}>
                                ⚠ Overrides activos — OVR se recalcula al aprobar
                              </div>
                            )}

                            {/* Notes */}
                            <textarea
                              placeholder="Notas para el jugador (opcional)..."
                              value={cartaNotas[pid] ?? ''}
                              onChange={e => setCartaNotas(prev => ({ ...prev, [pid]: e.target.value }))}
                              rows={2}
                              style={{
                                width: '100%', padding: 10, fontSize: 13,
                                background: 'var(--bg)', border: '1px solid var(--border)',
                                borderRadius: 3, color: 'var(--text)', resize: 'vertical',
                                fontFamily: 'inherit', boxSizing: 'border-box',
                              }}
                            />

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                disabled={cartaActioning === pid}
                                onClick={async () => {
                                  setCartaActioning(pid)
                                  const body: Record<string, unknown> = {
                                    player_id: pid,
                                    accion: 'aprobar',
                                    notas_admin: cartaNotas[pid] ?? null,
                                  }
                                  if (Object.keys(overrides).length > 0) body.stat_overrides = overrides
                                  const res = await fetch('/api/carta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                                  if (res.ok) {
                                    setCartaNotas(prev => { const n = { ...prev }; delete n[pid]; return n })
                                    setCartaOverrides(prev => { const n = { ...prev }; delete n[pid]; return n })
                                    await cargarCartas()
                                  }
                                  setCartaActioning(null)
                                }}
                                className="btn btn-primary"
                                style={{ flex: 1, fontSize: 13 }}
                              >
                                {cartaActioning === pid ? '...' : '✓ Aprobar'}
                              </button>
                              <button
                                disabled={cartaActioning === pid}
                                onClick={async () => {
                                  setCartaActioning(pid)
                                  const res = await fetch('/api/carta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: pid, accion: 'rechazar', notas_admin: cartaNotas[pid] ?? null }) })
                                  if (res.ok) {
                                    setCartaNotas(prev => { const n = { ...prev }; delete n[pid]; return n })
                                    await cargarCartas()
                                  }
                                  setCartaActioning(null)
                                }}
                                className="btn btn-danger"
                                style={{ flex: 1, fontSize: 13 }}
                              >
                                ✕ Rechazar
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* APPROVED */}
                {cartas.filter(c => c.aprobado).length > 0 && (
                  <div>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--green)', marginBottom: 12 }}>
                      ✓ APROBADAS ({cartas.filter(c => c.aprobado).length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {cartas.filter(c => c.aprobado).map(carta => {
                        const pid = carta.player_id as string
                        const profile = carta.profiles as { username: string; avatar_url: string | null } | null
                        const STATS = ['res', 'fis', 'def', 'ata', 'tec', 'dis'] as const
                        return (
                          <div key={pid} className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                            <PlayerAvatar url={profile?.avatar_url ?? null} username={profile?.username ?? '?'} size={32} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{profile?.username ?? pid}</div>
                              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                                {STATS.map(s => `${s.toUpperCase()} ${carta[`stat_${s}` as keyof typeof carta] as number}`).join(' · ')}
                              </div>
                              {(carta.notas_admin as string | null) && (
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                                  📝 {carta.notas_admin as string}
                                </div>
                              )}
                            </div>
                            <div className="mono" style={{ fontSize: 20, fontWeight: 900, color: 'var(--green)' }}>{carta.ovr as number}</div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                              {String(carta.tier).toUpperCase()}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* REJECTED */}
                {cartas.filter(c => c.rechazado && !c.aprobado).length > 0 && (
                  <div>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--red)', marginBottom: 12 }}>
                      ✕ RECHAZADAS ({cartas.filter(c => c.rechazado && !c.aprobado).length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {cartas.filter(c => c.rechazado && !c.aprobado).map(carta => {
                        const pid = carta.player_id as string
                        const profile = carta.profiles as { username: string; avatar_url: string | null } | null
                        return (
                          <div key={pid} className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, opacity: 0.7 }}>
                            <PlayerAvatar url={profile?.avatar_url ?? null} username={profile?.username ?? '?'} size={32} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{profile?.username ?? pid}</div>
                              {(carta.notas_admin as string | null) && (
                                <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                  📝 {carta.notas_admin as string}
                                </div>
                              )}
                            </div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--red)' }}>RECHAZADO</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB: HISTORIAL */}
        {tab === 'historial' && (
          <div id="tab-historial" className="fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                HISTORIAL — {historial.length} partidos pasados
              </div>
              <button onClick={cargarHistorial} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>↻ Refrescar</button>
            </div>
            {historialLoading ? (
              <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Cargando...</div>
            ) : historial.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 48 }}>
                <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>No hay partidos pasados registrados.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {historial.map(p => {
                  const confirmados = (p.inscripciones ?? []).filter((i: { estado: string }) => i.estado === 'confirmado').length
                  const badges = p.player_badges ?? []
                  const score = p.goles_a != null && p.goles_b != null
                    ? `${p.goles_a} – ${p.goles_b}`
                    : p.resultado ?? null
                  return (
                    <div key={p.id} className="card" style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <div className="display" style={{ fontSize: 20, letterSpacing: '0.05em' }}>
                            {p.dia_semana.toUpperCase()}
                            <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
                              {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                          <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                            {confirmados} jugadores
                            {score && <span style={{ color: 'var(--text)', fontWeight: 600, marginLeft: 12 }}>🤍 {score} 🖤</span>}
                            {!score && <span style={{ color: 'var(--text-dim)', marginLeft: 12 }}>sin resultado</span>}
                          </div>
                        </div>
                        {p.equipos_confirmados && (
                          <div className="mono" style={{ fontSize: 10, color: 'var(--green)', border: '1px solid #16a34a', padding: '2px 8px', borderRadius: 2 }}>
                            CONFIRMADO
                          </div>
                        )}
                      </div>
                      {badges.length > 0 && (
                        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {badges.map((b, i) => (
                            <div key={i} className="mono" style={{ fontSize: 11, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 2, padding: '3px 8px' }}>
                              {b.badge_emoji} {b.badge_nombre}
                              {b.profiles && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>· {b.profiles.username}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB: AJUSTES */}
        {tab === 'ajustes' && (
          <div id="tab-ajustes" className="fade-in">
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 32 }}>CONFIGURACIÓN</div>

            {settingsLoading ? (
              <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', padding: 48, textAlign: 'center' }}>Cargando...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>

                {/* Push notifications */}
                <div className="card" style={{ padding: '20px 24px' }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--amber)', marginBottom: 20 }}>🔔 NOTIFICACIONES PUSH</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {([
                      { key: 'notif_apertura',     label: 'Inscripciones abiertas',  desc: 'Cuando abre la ventana de inscripción para un partido' },
                      { key: 'notif_recordatorio', label: 'Recordatorio de partido', desc: 'A los confirmados, ≤10h antes del partido' },
                      { key: 'notif_cupos',        label: 'Cupos disponibles',       desc: 'A no-inscritos cuando quedan cupos libres' },
                      { key: 'notif_invitados',    label: 'Promoción de invitados',  desc: 'Mueve invitados de espera a confirmado el día del partido' },
                    ] as const).map(({ key, label, desc }) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                        </div>
                        <button
                          onClick={() => toggleSetting(key, !settings[key])}
                          style={{
                            flexShrink: 0, width: 44, height: 24, borderRadius: 12,
                            background: settings[key] !== false ? 'var(--green)' : 'var(--border)',
                            border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                          }}
                        >
                          <div style={{
                            position: 'absolute', top: 3, left: settings[key] !== false ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                          }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Email notifications */}
                <div className="card" style={{ padding: '20px 24px' }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--amber)', marginBottom: 20 }}>✉️ NOTIFICACIONES EMAIL</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {([
                      { key: 'email_apertura',     label: 'Email apertura partido',    desc: 'Correo a todos los jugadores cuando se abren inscripciones' },
                      { key: 'email_recordatorio', label: 'Email recordatorio partido', desc: 'Correo a confirmados el día del partido (cron 10am)' },
                    ] as const).map(({ key, label, desc }) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                        </div>
                        <button
                          onClick={() => toggleSetting(key, !settings[key])}
                          style={{
                            flexShrink: 0, width: 44, height: 24, borderRadius: 12,
                            background: settings[key] !== false ? 'var(--green)' : 'var(--border)',
                            border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                          }}
                        >
                          <div style={{
                            position: 'absolute', top: 3, left: settings[key] !== false ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                          }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Test email */}
                <div className="card" style={{ padding: '20px 24px' }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 16 }}>📧 ENVIAR EMAIL DE PRUEBA</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={testEmailAddr}
                      onChange={e => { setTestEmailAddr(e.target.value); setTestEmailResult(null) }}
                      style={{ flex: 1 }}
                    />
                    <button
                      onClick={enviarEmailPrueba}
                      disabled={testEmailSending || !testEmailAddr}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '10px 18px', whiteSpace: 'nowrap' }}
                    >
                      {testEmailSending ? 'Enviando...' : 'Enviar'}
                    </button>
                  </div>
                  {testEmailResult && (
                    <div className="mono" style={{
                      fontSize: 12, marginTop: 10, padding: '8px 12px', borderRadius: 3,
                      ...(testEmailResult.ok
                        ? { color: 'var(--green)', background: '#0f2d1a', border: '1px solid #16a34a' }
                        : { color: 'var(--red)', background: '#2d0a0a', border: '1px solid #7f1d1d' }),
                    }}>
                      {testEmailResult.ok ? '✓ ' : '✕ '}{testEmailResult.msg}
                    </div>
                  )}
                </div>

                {/* Cron info */}
                <div className="card" style={{ padding: '16px 24px' }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>⏱ CRON SCHEDULE</div>
                  <div className="mono" style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--green)' }}>0 15 * * *</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>→ 10:00 AM Colombia (15:00 UTC)</span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
                    Corre diariamente. Envía push + email de apertura e inscripciones. Verifica recordatorio (≤10h antes), cupos y promoción de invitados.
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {tab === 'log' && (
          <div id="tab-log" className="fade-in">
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

      {/* Modal Editar Partido */}
      {editPartidoModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, zIndex: 100
        }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 400 }}>
            <h3 className="display" style={{ fontSize: 24, marginBottom: 8 }}>Editar partido</h3>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
              {editPartidoModal.dia_semana.toUpperCase()} · {editPartidoModal.fecha}
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
                  <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>HORA APERTURA</label>
                  <input type="time" value={nuevaHoraApertura} onChange={e => setNuevaHoraApertura(e.target.value)} />
                </div>
                <div>
                  <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>DÍAS ANTES</label>
                  <input type="number" min="0" max="7" value={nuevosDiasAntes} onChange={e => setNuevosDiasAntes(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>CUPOS</label>
                <input type="number" min="1" max="30" value={nuevosCupos} onChange={e => setNuevosCupos(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={editarPartido} disabled={!nuevaFecha} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Guardar cambios
              </button>
              <button onClick={() => setEditPartidoModal(null)} className="btn btn-ghost">Cancelar</button>
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

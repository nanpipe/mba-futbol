'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import Link from 'next/link'
import { calcularVentanaPartido } from '@/lib/partidos'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { colorLabel } from '@/lib/design'

interface Partido {
  id: string
  fecha: string
  dia_semana: string
  hora?: string
  hora_apertura?: string
  dias_antes_apertura?: number
  cupos_total?: number
  equipos_confirmados?: boolean
  evaluaciones_abiertas?: boolean
  foto_url?: string | null
  goles_a?: number | null
  goles_b?: number | null
  resultado?: string | null
  tipo?: string | null
  puntos_blanco?: number | null
  puntos_negro?: number | null
  puntos_morado?: number | null
}

interface Badge {
  badge_id: string
  badge_emoji: string
  badge_nombre: string
  profiles: { username: string } | null
}

interface EquipoJugador {
  id: string
  username: string
  avatar_url: string | null
  posicion: string
  habilidad: number
}

interface Equipo {
  id: string
  nombre: 'A' | 'B'
  color: 'blanco' | 'negro'
  confirmado: boolean
  portero_fijo: boolean
  portero_fijo_id: string | null
  rotacion_banca: string[] | null
  rotacion_portero: string[] | null
  jugadores: EquipoJugador[]
}

interface Inscripcion {
  id: string
  player_id: string
  estado: 'confirmado' | 'espera'
  posicion_espera: number | null
  profiles: { username: string }
}

interface Invitado {
  id: string
  nombre: string
  estado: 'espera' | 'confirmado'
  posicion_espera: number | null
}

interface InvitadoPublico {
  id: string
  nombre: string
  estado: 'espera' | 'confirmado'
  posicion_espera: number | null
  player_id: string
  profiles: { username: string }
}

interface VentanaInfo {
  abierta: boolean
  partido: Partido | null
  abreEn: string | null
  msHastaAbre: number
}

export default function HomePage() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<{ username: string; role: string; baneado: boolean; avatar_url: string | null } | null>(null)
  const [ventana, setVentana] = useState<VentanaInfo | null>(null)
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([])
  const [miInscripcion, setMiInscripcion] = useState<Inscripcion | null>(null)
  const [loading, setLoading] = useState(true)
  const [inscribiendose, setInscribiendose] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [misInvitados, setMisInvitados] = useState<Invitado[]>([])
  const [todosInvitados, setTodosInvitados] = useState<InvitadoPublico[]>([])
  const [nuevoInvitado, setNuevoInvitado] = useState('')
  const [agregandoInvitado, setAgregandoInvitado] = useState(false)
  const [countdown, setCountdown] = useState('')
  const [ultimoPartido, setUltimoPartido] = useState<{ partido: Partido; inscripciones: Inscripcion[]; badges: Badge[] } | null>(null)
  const [misEquipos, setMisEquipos] = useState<{ equipos: Equipo[]; miEquipo: Equipo | null; partido_id: string } | null>(null)
  const abreEnRef = useRef<Date | null>(null)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | null>(null)
  const [installPrompt, setInstallPrompt] = useState<Event & { prompt: () => void } | null>(null)
  const [isIos, setIsIos] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [pullY, setPullY] = useState(0)
  const [pulling, setPulling] = useState(false)
  const touchStartY = useRef(0)
  const PULL_THRESHOLD = 72

  useEffect(() => {
    if ('Notification' in window) setPushPermission(Notification.permission)
    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent))
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)

    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as Event & { prompt: () => void }) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const activarPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const permission = await Notification.requestPermission()
    setPushPermission(permission)
    if (permission !== 'granted') return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_PUSHER_APP_KEY!),
    })
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    })
  }

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
  }

  const cargarDatos = useCallback(async (u: User) => {
    const { data: prof } = await supabase.from('profiles').select('username, role, baneado, avatar_url').eq('id', u.id).single()
    setProfile(prof)

    const hoy = new Date().toISOString().split('T')[0]

    // Always load last match (for eval CTA + results) in parallel with upcoming match
    const cargarUltimo = async () => {
      const { data: ultimo } = await supabase
        .from('partidos')
        .select('id, fecha, dia_semana, evaluaciones_abiertas, foto_url, goles_a, goles_b, resultado, tipo, puntos_blanco, puntos_negro, puntos_morado')
        .lt('fecha', hoy)
        .order('fecha', { ascending: false })
        .limit(1)
        .single()
      if (ultimo) {
        const [{ data: ins }, { data: bdgs }] = await Promise.all([
          supabase
            .from('inscripciones')
            .select('id, player_id, estado, posicion_espera, profiles!player_id(username)')
            .eq('partido_id', ultimo.id)
            .eq('estado', 'confirmado'),
          supabase
            .from('player_badges')
            .select('badge_id, badge_emoji, badge_nombre, profiles!player_badges_player_id_fkey(username)')
            .eq('partido_id', ultimo.id),
        ])
        setUltimoPartido({
          partido: ultimo,
          inscripciones: (ins as unknown as Inscripcion[]) ?? [],
          badges: (bdgs as unknown as Badge[]) ?? [],
        })
      }
    }

    // Fetch next upcoming partido
    const { data: partido } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, cupos_total, equipos_confirmados, evaluaciones_abiertas')
      .gte('fecha', hoy)
      .order('fecha', { ascending: true })
      .limit(1)
      .single()

    if (!partido) {
      await cargarUltimo()
      setVentana({ abierta: false, partido: null, abreEn: null, msHastaAbre: 0 })
      setLoading(false)
      return
    }

    const { abierta, abreEn, cierra } = calcularVentanaPartido(partido)
    const now = new Date()

    // Match already happened
    if (now >= cierra) {
      await cargarUltimo()
      setVentana({ abierta: false, partido: null, abreEn: null, msHastaAbre: 0 })
      setLoading(false)
      return
    }

    // Window not yet open — show countdown but still load last match for eval
    if (!abierta) {
      abreEnRef.current = abreEn
      cargarUltimo() // fire-and-forget, updates state when done
      setVentana({ abierta: false, partido: null, abreEn: null, msHastaAbre: abreEn.getTime() - now.getTime() })
      setLoading(false)
      return
    }

    // Window is open — also load last match for eval CTA
    cargarUltimo() // fire-and-forget
    setVentana({ abierta: true, partido, abreEn: null, msHastaAbre: 0 })

    const { data: ins } = await supabase
      .from('inscripciones')
      .select('id, player_id, estado, posicion_espera, profiles!player_id(username)')
      .eq('partido_id', partido.id)
      .order('estado', { ascending: true })
      .order('posicion_espera', { ascending: true, nullsFirst: false })

    setInscripciones((ins as unknown as Inscripcion[]) ?? [])
    setMiInscripcion((ins as unknown as Inscripcion[])?.find(i => i.player_id === u.id) ?? null)

    // Load teams if confirmed
    if (partido.equipos_confirmados) {
      const teamsRes = await fetch(`/api/equipos?partido_id=${partido.id}`)
      const teamsData = await teamsRes.json()
      if (teamsData.equipos) {
        const eqs: Equipo[] = teamsData.equipos
        const mine = eqs.find(e => e.jugadores.some(j => j.id === u.id)) ?? null
        setMisEquipos({ equipos: eqs, miEquipo: mine, partido_id: partido.id })
      }
    } else {
      setMisEquipos(null)
    }

    // Load player's own invitees + all invitees for public waiting list
    const [{ data: invs }, { data: todosInvs }] = await Promise.all([
      supabase
        .from('invitados')
        .select('id, nombre, estado, posicion_espera')
        .eq('partido_id', partido.id)
        .eq('player_id', u.id)
        .order('posicion_espera', { ascending: true }),
      supabase
        .from('invitados')
        .select('id, nombre, estado, posicion_espera, player_id, profiles(username)')
        .eq('partido_id', partido.id)
        .order('posicion_espera', { ascending: true, nullsFirst: false }),
    ])
    setMisInvitados((invs as Invitado[]) ?? [])
    setTodosInvitados((todosInvs as unknown as InvitadoPublico[]) ?? [])

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u)
      if (u) cargarDatos(u)
      else setLoading(false)
    })
  }, [supabase, cargarDatos])

  // Countdown timer
  useEffect(() => {
    if (!ventana || ventana.abierta || !abreEnRef.current) return
    const interval = setInterval(() => {
      const ms = (abreEnRef.current?.getTime() ?? 0) - Date.now()
      if (ms <= 0) { clearInterval(interval); return }
      const h = Math.floor(ms / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setCountdown(`${h}h ${m}m ${s}s`)
    }, 1000)
    return () => clearInterval(interval)
  }, [ventana])

  const inscribirse = async () => {
    if (!ventana?.partido || !user) return
    setInscribiendose(true)
    setMensaje(null)
    try {
      const res = await fetch('/api/inscripciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partido_id: ventana.partido.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error })
      } else {
        const texto = data.estado === 'confirmado'
          ? '¡Estás dentro! Cupo confirmado.'
          : `En lista de espera — posición #${data.posicion_espera}`
        setMensaje({ tipo: 'ok', texto })
        cargarDatos(user)
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de conexión. Intenta de nuevo.' })
    }
    setInscribiendose(false)
  }

  const cancelar = async () => {
    if (!ventana?.partido || !user || !miInscripcion) return
    if (!confirm('¿Seguro que quieres liberar tu cupo?')) return
    const res = await fetch('/api/inscripciones', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id: ventana.partido.id }),
    })
    if (res.ok) {
      setMensaje({ tipo: 'ok', texto: 'Cupo liberado.' })
      cargarDatos(user)
    }
  }

  const agregarInvitado = async () => {
    if (!ventana?.partido || !nuevoInvitado.trim()) return
    setAgregandoInvitado(true)
    const res = await fetch('/api/invitados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id: ventana.partido.id, nombre: nuevoInvitado.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setNuevoInvitado('')
      if (user) cargarDatos(user)
    } else {
      setMensaje({ tipo: 'error', texto: data.error })
    }
    setAgregandoInvitado(false)
  }

  const eliminarInvitado = async (invitado_id: string) => {
    await fetch('/api/invitados', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitado_id }),
    })
    if (user) cargarDatos(user)
  }

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const confirmados = inscripciones.filter(i => i.estado === 'confirmado')
  const enEspera = inscripciones.filter(i => i.estado === 'espera')
  const cuposTotal = ventana?.partido?.cupos_total ?? 14
  const invitadosConfirmados = todosInvitados.filter(i => i.estado === 'confirmado')
  const invitadosEspera = todosInvitados.filter(i => i.estado === 'espera')
  const totalConfirmados = confirmados.length + invitadosConfirmados.length
  // Sequential position in espera (gaps removed — someone may have been confirmed out of order)
  const miPosicionEspera = miInscripcion?.estado === 'espera'
    ? enEspera.findIndex(i => i.id === miInscripcion.id) + 1
    : null
  const cuposLibres = cuposTotal - totalConfirmados

  // Pull-to-refresh handlers (PWA standalone loses native browser pull-to-refresh)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (window.scrollY > 0) return // only activate when already at top
    const delta = e.touches[0].clientY - touchStartY.current
    if (delta > 0) {
      setPullY(Math.min(delta, PULL_THRESHOLD + 24))
      setPulling(true)
    }
  }
  const handleTouchEnd = () => {
    if (pullY >= PULL_THRESHOLD) window.location.reload()
    setPullY(0)
    setPulling(false)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>
          CARGANDO...
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
        <Header />
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/login" className="btn btn-primary">Iniciar sesión</Link>
          <Link href="/registro" className="btn btn-ghost">Registrarse</Link>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ minHeight: '100vh', paddingBottom: 80 }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pulling && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: Math.min(pullY, PULL_THRESHOLD + 24),
            background: 'var(--bg)',
            borderBottom: pullY >= PULL_THRESHOLD ? '1px solid var(--green)' : '1px solid var(--border)',
            transition: 'border-color 0.15s',
            overflow: 'hidden',
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 12,
              color: pullY >= PULL_THRESHOLD ? 'var(--green)' : 'var(--text-muted)',
              letterSpacing: '0.1em',
              opacity: Math.min(pullY / PULL_THRESHOLD, 1),
              transition: 'color 0.15s',
            }}
          >
            {pullY >= PULL_THRESHOLD ? '↻ SOLTAR PARA ACTUALIZAR' : '↓ BAJAR PARA ACTUALIZAR'}
          </span>
        </div>
      )}
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="display" style={{ fontSize: 20, letterSpacing: '0.1em' }}>MBA FC</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {(profile?.role === 'admin' || profile?.role === 'superadmin') && (
              <Link href="/admin" className="mono" style={{ fontSize: 12, color: 'var(--amber)', letterSpacing: '0.08em', textDecoration: 'none' }}>
                ADMIN ↗
              </Link>
            )}
            {isStandalone && (
              <button
                onClick={() => window.location.reload()}
                title="Recargar"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 20, lineHeight: 1,
                  padding: '4px 6px', borderRadius: 3,
                  display: 'flex', alignItems: 'center'
                }}
              >
                ↻
              </button>
            )}
            {installPrompt && !isStandalone && (
              <button onClick={() => { installPrompt.prompt(); setInstallPrompt(null) }} className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11, color: 'var(--green)', borderColor: '#16a34a' }}>
                📲 Instalar app
              </button>
            )}
            {pushPermission !== 'granted' && pushPermission !== null && 'PushManager' in window && (
              <button onClick={activarPush} className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11, color: 'var(--amber)', borderColor: '#92400e' }}>
                🔔 Notificaciones
              </button>
            )}
            {/* Profile avatar + username → /perfil */}
            <Link href="/perfil" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: profile?.avatar_url ? 'transparent' : '#0f2d1a',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span className="display" style={{ fontSize: 12, color: 'var(--green)', lineHeight: 1 }}>
                    {profile?.username?.[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
              </div>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{profile?.username}</span>
            </Link>
            <button onClick={cerrarSesion} className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 11 }}>Salir</button>
          </div>
        </div>
      </nav>

      {isIos && !isStandalone && (
        <div className="mono" style={{ background: '#0f1f0f', borderBottom: '1px solid #1a3a1a', padding: '10px 0', textAlign: 'center', fontSize: 11, color: 'var(--green)', letterSpacing: '0.05em' }}>
          Para instalar: toca <strong>Compartir</strong> → <strong>Agregar a pantalla de inicio</strong>
        </div>
      )}

      <div className="container" style={{ paddingTop: 48 }}>
        {/* Header */}
        <Header />

        <div style={{ height: 48 }} />

        {/* Estado ventana */}
        {!ventana?.abierta ? (
          <>
            <div className="card fade-in" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 16 }}>
                INSCRIPCIONES CERRADAS
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, marginBottom: 8 }}>
                Las inscripciones abren los <strong style={{ color: 'var(--text)' }}>domingos a las 10:00 am</strong> para el martes<br />
                y los <strong style={{ color: 'var(--text)' }}>jueves a las 10:00 am</strong> para el viernes.
              </p>
              {countdown && (
                <div className="display" style={{ fontSize: 36, color: 'var(--green)', marginTop: 24 }}>
                  {countdown}
                </div>
              )}
            </div>

            {ultimoPartido && ultimoPartido.inscripciones.length > 0 && (
              <div style={{ marginTop: 40 }} className="fade-in">
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 4 }}>
                  ÚLTIMO PARTIDO — {ultimoPartido.partido.dia_semana.toUpperCase()}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16 }}>
                  {new Date(ultimoPartido.partido.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })} · 7:00 PM
                </div>

                {/* Eval closed: show photo + winner + badge results */}
                {!ultimoPartido.partido.evaluaciones_abiertas && ultimoPartido.badges.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Match photo */}
                    {ultimoPartido.partido.foto_url && (
                      <div style={{ borderRadius: 6, overflow: 'hidden' }}>
                        <img
                          src={ultimoPartido.partido.foto_url}
                          alt="Foto del partido"
                          style={{ width: '100%', display: 'block', maxHeight: 400, objectFit: 'contain' }}
                        />
                      </div>
                    )}

                    {/* Match result / winner */}
                    {(() => {
                      const p = ultimoPartido.partido
                      const esMinitorneo = p.tipo === 'minitorneo'
                      if (esMinitorneo && p.puntos_blanco != null) {
                        const pts = [
                          { label: 'Blancos 🤍', pts: p.puntos_blanco ?? 0 },
                          { label: 'Negros 🖤', pts: p.puntos_negro ?? 0 },
                          { label: 'Morados 💜', pts: p.puntos_morado ?? 0 },
                        ]
                        const winner = pts.reduce((a, b) => b.pts > a.pts ? b : a)
                        return (
                          <div style={{ padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                              <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 4 }}>GANADOR DEL PARTIDO</div>
                              <div className="display" style={{ fontSize: 20 }}>{winner.label}</div>
                            </div>
                            <div className="mono" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                              B{p.puntos_blanco} · N{p.puntos_negro} · M{p.puntos_morado}
                            </div>
                          </div>
                        )
                      }
                      if (!esMinitorneo && p.goles_a != null && p.goles_b != null) {
                        const winnerLabel = p.goles_a > p.goles_b ? 'Equipo Blanco 🤍' : p.goles_b > p.goles_a ? 'Equipo Negro 🖤' : 'Empate'
                        return (
                          <div style={{ padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                              <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 4 }}>GANADOR DEL PARTIDO</div>
                              <div className="display" style={{ fontSize: 20 }}>{winnerLabel}</div>
                            </div>
                            <div className="display" style={{ fontSize: 24, color: 'var(--green)' }}>
                              {p.goles_a} – {p.goles_b}
                            </div>
                          </div>
                        )
                      }
                      return null
                    })()}

                    {/* Badge winners */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {ultimoPartido.badges.map(b => (
                        <div key={b.badge_id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 14px', background: 'var(--bg-card)',
                          border: '1px solid var(--border)', borderRadius: 4,
                        }}>
                          <span style={{ fontSize: 22, flexShrink: 0 }}>{b.badge_emoji}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 1 }}>{b.badge_nombre}</div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{b.profiles?.username ?? '?'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Eval open or no badges: show player list */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {ultimoPartido.inscripciones.map((ins, idx) => (
                      <div key={ins.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 16px', background: 'var(--bg-card)', borderRadius: 3,
                        border: ins.player_id === user?.id ? '1px solid #16a34a' : '1px solid transparent'
                      }}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', width: 20 }}>{idx + 1}</span>
                        <span style={{ fontSize: 15, flex: 1 }}>{ins.profiles.username}</span>
                        {ins.player_id === user?.id && (
                          <span className="mono" style={{ fontSize: 10, color: 'var(--green)', letterSpacing: '0.1em' }}>TÚ</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="fade-in">
            {/* Partido info */}
            <div style={{ marginBottom: 24 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 8 }}>
                PRÓXIMO PARTIDO
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <h2 className="display" style={{ fontSize: 52, lineHeight: 1 }}>
                  {ventana.partido?.dia_semana?.toUpperCase()}
                </h2>
                <span className="mono" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {ventana.partido?.fecha
                    ? new Date(ventana.partido.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })
                    : ''} · 7:00 PM
                </span>
              </div>
            </div>

            {/* Barra de cupos */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span className="mono" style={{ fontSize: 12, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>CUPOS</span>
                <span className="mono" style={{ fontSize: 13 }}>
                  <strong style={{ color: totalConfirmados >= cuposTotal ? 'var(--red)' : 'var(--green)' }}>{totalConfirmados}</strong>
                  <span style={{ color: 'var(--text-dim)' }}>/{cuposTotal}</span>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cuposTotal}, 1fr)`, gap: 4 }}>
                {Array.from({ length: cuposTotal }, (_, i) => (
                  <div key={i} style={{
                    height: 8, borderRadius: 2,
                    background: i < totalConfirmados ? 'var(--green)' : 'var(--border-light)'
                  }} />
                ))}
              </div>
              {enEspera.length > 0 && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--amber)', marginTop: 12, letterSpacing: '0.05em' }}>
                  {enEspera.length} en lista de espera
                </div>
              )}
            </div>

            {/* Mensaje */}
            {mensaje && (
              <div style={{
                padding: '12px 16px', borderRadius: 3, marginBottom: 20,
                background: mensaje.tipo === 'ok' ? '#0f2d1a' : '#2d0a0a',
                border: `1px solid ${mensaje.tipo === 'ok' ? '#16a34a' : '#7f1d1d'}`,
                color: mensaje.tipo === 'ok' ? 'var(--green)' : 'var(--red)',
                fontFamily: 'DM Mono, monospace', fontSize: 13
              }}>
                {mensaje.texto}
              </div>
            )}

            {/* Acción del usuario */}
            {profile?.baneado ? (
              <div className="card" style={{ borderColor: '#3a1a1a', textAlign: 'center', padding: '24px' }}>
                <span className="badge badge-red" style={{ marginBottom: 8 }}>SUSPENDIDO</span>
                <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                  Contacta al admin para regularizar tu situación.
                </p>
              </div>
            ) : miInscripcion ? (
              <div className="card" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderColor: miInscripcion.estado === 'confirmado' ? '#16a34a' : '#92400e'
              }}>
                <div>
                  <span className={`badge ${miInscripcion.estado === 'confirmado' ? 'badge-green' : 'badge-amber'}`}>
                    {miInscripcion.estado === 'confirmado' ? '✓ CONFIRMADO' : `ESPERA #${miPosicionEspera}`}
                  </span>
                  <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    {miInscripcion.estado === 'confirmado'
                      ? 'Estás dentro. Nos vemos en la cancha.'
                      : 'Te notificamos por email si entra un cupo.'}
                  </p>
                </div>
                <button onClick={cancelar} className="btn btn-danger" style={{ flexShrink: 0 }}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button onClick={inscribirse} disabled={inscribiendose} className="btn btn-primary" style={{ width: '100%', padding: '16px', fontSize: 14 }}>
                {inscribiendose ? 'Inscribiendo...' : cuposLibres > 0 ? 'Inscribirse al partido' : 'Entrar a lista de espera'}
              </button>
            )}

            {/* Mis invitados */}
            {miInscripcion && (
              <div style={{ marginTop: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                    MIS INVITADOS ({misInvitados.length}/3)
                  </div>
                </div>

                {misInvitados.map(inv => (
                  <div key={inv.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 3,
                    border: '1px solid #1a2a3a', marginBottom: 4
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className={`badge ${inv.estado === 'confirmado' ? 'badge-green' : 'badge-amber'}`}>
                        {inv.estado === 'confirmado' ? '✓' : `ESPERA #${invitadosEspera.findIndex(i => i.id === inv.id) + 1}`}
                      </span>
                      <span style={{ fontSize: 14 }}>{inv.nombre}</span>
                    </div>
                    <button
                      onClick={() => eliminarInvitado(inv.id)}
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {misInvitados.length < 3 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      type="text"
                      value={nuevoInvitado}
                      onChange={e => setNuevoInvitado(e.target.value)}
                      placeholder="Nombre del invitado"
                      maxLength={80}
                      onKeyDown={e => e.key === 'Enter' && agregarInvitado()}
                      style={{ flex: 1 }}
                    />
                    <button
                      onClick={agregarInvitado}
                      disabled={agregandoInvitado || !nuevoInvitado.trim()}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '8px 14px', whiteSpace: 'nowrap' }}
                    >
                      {agregandoInvitado ? '...' : '+ Agregar'}
                    </button>
                  </div>
                )}

                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
                  Los invitados están en lista de espera. Si quedan cupos a las 2:00 PM del día del partido, entran automáticamente.
                </div>
              </div>
            )}

            {/* Teams display when confirmed */}
            {misEquipos && (() => {
              const myUsername = profile?.username ?? ''
              const colorAccent = (eq: Equipo) => eq.nombre === 'A' ? 'var(--green)' : 'var(--amber)'
              const colorBorder = (eq: Equipo) => eq.nombre === 'A' ? '#16a34a' : '#92400e'
              const colorBg = (eq: Equipo) => eq.nombre === 'A' ? '#0a1f0a' : '#1a0e00'

              const getMyRole = (eq: Equipo): { label: string; sub?: string; color: string } => {
                if (eq.portero_fijo && eq.portero_fijo_id === myUsername) {
                  return { label: '🧤 Portero titular', sub: 'no rota', color: '#818cf8' }
                }
                const bancaIdx = (eq.rotacion_banca ?? []).indexOf(myUsername)
                if (bancaIdx >= 0) {
                  return {
                    label: bancaIdx === 0 ? '🔄 Empieza en banca' : `🔄 Banca — turno #${bancaIdx + 1}`,
                    sub: bancaIdx === 0 ? 'primer turno de entrada' : undefined,
                    color: 'var(--amber)',
                  }
                }
                const porteroIdx = (eq.rotacion_portero ?? []).indexOf(myUsername)
                if (porteroIdx >= 0) {
                  return {
                    label: porteroIdx === 0 ? '🧤 Primer portero' : `🧤 Portero — turno #${porteroIdx + 1}`,
                    sub: porteroIdx === 0 ? 'primer turno en arco' : undefined,
                    color: '#818cf8',
                  }
                }
                return { label: '⚽ Titular', sub: 'empieza en cancha', color: colorAccent(eq) }
              }

              return (
                <div style={{ marginTop: 40 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--green)', marginBottom: 20 }}>
                    ⚽ EQUIPOS CONFIRMADOS
                  </div>

                  {misEquipos.equipos.map(eq => {
                    const isMyTeam = eq.jugadores.some(j => j.id === user?.id)
                    const myRole = isMyTeam ? getMyRole(eq) : null
                    const accent = colorAccent(eq)
                    const border = colorBorder(eq)
                    const bg = colorBg(eq)

                    return (
                      <div key={eq.id} style={{ marginBottom: 24, border: `1px solid ${isMyTeam ? border : 'var(--border)'}`, borderRadius: 6, overflow: 'hidden' }}>
                        {/* Team header */}
                        <div style={{ background: isMyTeam ? bg : 'var(--bg-card)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${isMyTeam ? border : 'var(--border)'}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: '0.05em' }}>
                              EQUIPO {eq.nombre}
                            </span>
                            <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg)', padding: '2px 8px', borderRadius: 3, border: '1px solid var(--border)' }}>
                              {colorLabel(eq.color)}
                            </span>
                          </div>
                          {isMyTeam && (
                            <span className="mono" style={{ fontSize: 10, color: accent, letterSpacing: '0.1em' }}>TU EQUIPO</span>
                          )}
                        </div>

                        {/* My role banner */}
                        {myRole && (
                          <div style={{ background: bg, borderBottom: `1px solid ${border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="mono" style={{ fontSize: 13, color: myRole.color, fontWeight: 600 }}>{myRole.label}</span>
                            {myRole.sub && <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>— {myRole.sub}</span>}
                          </div>
                        )}

                        {/* Goalkeeper info */}
                        {eq.portero_fijo && eq.portero_fijo_id && (
                          <div style={{ padding: '8px 16px', background: '#0d0d1a', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="mono" style={{ fontSize: 10, color: '#818cf8', letterSpacing: '0.1em' }}>🧤 PORTERO FIJO</span>
                            <span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{eq.portero_fijo_id}</span>
                            <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>— no rota</span>
                          </div>
                        )}

                        {/* Players list */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--bg)' }}>
                          {eq.jugadores.map(j => {
                            const isMe = j.id === user?.id
                            const isPorteroFijo = eq.portero_fijo && eq.portero_fijo_id === j.username
                            return (
                              <div key={j.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '9px 16px', background: isMe ? bg : 'transparent',
                              }}>
                                <PlayerAvatar url={j.avatar_url} username={j.username} size={28} borderColor={isMe ? border : 'var(--border)'} />
                                <span style={{ fontSize: 14, flex: 1, color: isMe ? 'var(--text)' : 'var(--text-muted)' }}>{j.username}</span>
                                {isPorteroFijo && <span style={{ fontSize: 13 }}>🧤</span>}
                                {isMe && <span className="mono" style={{ fontSize: 10, color: accent, letterSpacing: '0.1em' }}>TÚ</span>}
                              </div>
                            )
                          })}
                        </div>

                        {/* Rotations */}
                        {((eq.rotacion_banca ?? []).length > 0 || (eq.rotacion_portero ?? []).length > 0) && (
                          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                            {(eq.rotacion_banca ?? []).length > 0 && (
                              <div>
                                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 6 }}>ROTACIÓN BANCA</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  {(eq.rotacion_banca ?? []).map((u, i) => (
                                    <div key={u} className="mono" style={{ fontSize: 11, display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <span style={{ color: 'var(--text-dim)', width: 14, textAlign: 'right' }}>{i + 1}.</span>
                                      <span style={{ color: u === myUsername ? accent : 'var(--text-muted)', fontWeight: u === myUsername ? 700 : 400 }}>{u}</span>
                                      {i === 0 && <span style={{ fontSize: 10, color: 'var(--amber)' }}>← empieza</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {!eq.portero_fijo && (eq.rotacion_portero ?? []).length > 0 && (
                              <div>
                                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 6 }}>ROTACIÓN PORTERO</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  {(eq.rotacion_portero ?? []).map((u, i) => (
                                    <div key={u} className="mono" style={{ fontSize: 11, display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <span style={{ color: 'var(--text-dim)', width: 14, textAlign: 'right' }}>{i + 1}.</span>
                                      <span style={{ color: u === myUsername ? '#818cf8' : 'var(--text-muted)', fontWeight: u === myUsername ? 700 : 400 }}>{u}</span>
                                      {i === 0 && <span style={{ fontSize: 10, color: '#818cf8' }}>← primer portero</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {!misEquipos.miEquipo && (
                    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>No estás asignado a ningún equipo.</div>
                  )}
                </div>
              )
            })()}

            {/* Evaluation CTA */}
            {ventana?.partido?.evaluaciones_abiertas && ventana?.partido?.equipos_confirmados && miInscripcion?.estado === 'confirmado' && (
              <div style={{ marginTop: 32 }}>
                <div style={{ background: '#1a1500', border: '1px solid #92400e', borderRadius: 6, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 20 }}>📊</span>
                      <span className="display" style={{ fontSize: 18, letterSpacing: '0.05em' }}>Evalúa a tus compañeros</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      Anónimo · Solo toma 2 minutos · Reconoce a tus compañeros
                    </div>
                  </div>
                  <Link
                    href={`/evaluar/${ventana.partido.id}`}
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '10px 20px', color: 'var(--amber)', borderColor: '#92400e', whiteSpace: 'nowrap' }}
                  >
                    Evaluar ahora →
                  </Link>
                </div>
              </div>
            )}


            {/* Lista de jugadores */}
            {inscripciones.length > 0 && (
              <div style={{ marginTop: 40 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 16 }}>
                  JUGADORES — {totalConfirmados} CONFIRMADOS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {confirmados.map((ins, idx) => (
                    <div key={ins.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px', background: 'var(--bg-card)', borderRadius: 3,
                      border: ins.player_id === user.id ? '1px solid #16a34a' : '1px solid transparent'
                    }}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', width: 20 }}>{idx + 1}</span>
                      <span style={{ fontSize: 15, flex: 1 }}>{ins.profiles.username}</span>
                      {ins.player_id === user.id && (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--green)', letterSpacing: '0.1em' }}>TÚ</span>
                      )}
                    </div>
                  ))}
                </div>

                {enEspera.length > 0 && (
                  <>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', margin: '24px 0 12px' }}>
                      EN ESPERA
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {enEspera.map((ins, idx) => (
                        <div key={ins.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 16px', background: 'var(--bg-card)', borderRadius: 3,
                          border: ins.player_id === user.id ? '1px solid #92400e' : '1px solid transparent',
                          opacity: 0.7
                        }}>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', width: 20 }}>#{idx + 1}</span>
                          <span style={{ fontSize: 15 }}>{ins.profiles.username}</span>
                          {ins.player_id === user.id && (
                            <span className="mono" style={{ fontSize: 10, color: 'var(--amber)', letterSpacing: '0.1em' }}>TÚ</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Invitados waiting list — visible to everyone */}
                {todosInvitados.length > 0 && (
                  <>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', margin: '24px 0 12px' }}>
                      LISTA DE ESPERA — INVITADOS ({todosInvitados.filter(i => i.estado === 'espera').length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {todosInvitados.map((inv) => (
                        <div key={inv.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 16px', background: 'var(--bg-card)', borderRadius: 3,
                          border: inv.estado === 'confirmado' ? '1px solid #16a34a' : '1px solid transparent',
                          opacity: inv.estado === 'espera' ? 0.7 : 1,
                        }}>
                          <span className="mono" style={{
                            fontSize: 11, width: 20,
                            color: inv.estado === 'confirmado' ? 'var(--green)' : 'var(--amber)',
                          }}>
                            {inv.estado === 'confirmado' ? '✓' : `#${invitadosEspera.findIndex(i => i.id === inv.id) + 1}`}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 15 }}>{inv.nombre}</span>
                            <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 8 }}>
                              inv. de {inv.profiles.username}
                            </span>
                          </div>
                          <span className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.08em', flexShrink: 0 }}>INVITADO</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Evaluation CTA — last match, always visible regardless of inscription state */}
        {ultimoPartido?.partido?.evaluaciones_abiertas &&
          user &&
          ultimoPartido.inscripciones.some(i => i.player_id === user.id) && (
          <div style={{ marginTop: 32 }} className="fade-in">
            <div style={{ background: '#1a1500', border: '1px solid #92400e', borderRadius: 6, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 20 }}>📊</span>
                  <span className="display" style={{ fontSize: 18, letterSpacing: '0.05em' }}>Evalúa el último partido</span>
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  {ultimoPartido.partido.dia_semana} · Anónimo · Solo toma 2 minutos
                </div>
              </div>
              <Link
                href={`/evaluar/${ultimoPartido.partido.id}`}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '10px 20px', color: 'var(--amber)', borderColor: '#92400e', whiteSpace: 'nowrap' }}
              >
                Evaluar ahora →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Header() {
  return (
    <div>
      <div className="display" style={{ fontSize: 64, lineHeight: 0.9, letterSpacing: '0.03em' }}>
        MBA<br />
        <span style={{ color: 'var(--green)' }}>FÚTBOL</span><br />
        CLUB
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: 16 }}>
        MAR · VIE · 7:00 PM
      </div>
    </div>
  )
}

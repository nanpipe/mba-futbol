'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import Link from 'next/link'

interface Partido {
  id: string
  fecha: string
  dia_semana: string
}

interface Inscripcion {
  id: string
  player_id: string
  estado: 'confirmado' | 'espera'
  posicion_espera: number | null
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
  const [profile, setProfile] = useState<{ username: string; role: string; baneado: boolean } | null>(null)
  const [ventana, setVentana] = useState<VentanaInfo | null>(null)
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([])
  const [miInscripcion, setMiInscripcion] = useState<Inscripcion | null>(null)
  const [loading, setLoading] = useState(true)
  const [inscribiendose, setInscribiendose] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [countdown, setCountdown] = useState('')

  const calcularVentana = useCallback(() => {
    const ahora = new Date()
    // Hora Colombia (UTC-5)
    const col = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Bogota' }))
    const dia = col.getDay()
    const hora = col.getHours() + col.getMinutes() / 60

    let abierta = false
    let targetDia: 'martes' | 'viernes' | null = null
    let targetFecha: Date | null = null
    let abreMs: number | null = null

    if ((dia === 0 && hora >= 10) || dia === 1) {
      abierta = true; targetDia = 'martes'
      const diff = dia === 0 ? 2 : 1
      targetFecha = new Date(col)
      targetFecha.setDate(col.getDate() + diff)
    } else if (dia === 4 && hora >= 10) {
      abierta = true; targetDia = 'viernes'
      targetFecha = new Date(col)
      targetFecha.setDate(col.getDate() + 1)
    } else {
      let diasHasta: number
      if (dia === 0 && hora < 10) {
        diasHasta = 0
      } else if (dia === 4 && hora < 10) {
        diasHasta = 0
      } else {
        diasHasta = (7 - dia) % 7 || 7
      }
      const abre = new Date(col)
      abre.setDate(col.getDate() + diasHasta)
      abre.setHours(10, 0, 0, 0)
      abreMs = abre.getTime() - ahora.getTime()
    }

    return { abierta, targetDia, targetFecha, abreMs }
  }, [])

  const cargarDatos = useCallback(async (u: User) => {
    const { data: prof } = await supabase.from('profiles').select('username, role, baneado').eq('id', u.id).single()
    setProfile(prof)

    const { abierta, targetDia, targetFecha, abreMs } = calcularVentana()

    if (!abierta || !targetFecha || !targetDia) {
      setVentana({ abierta: false, partido: null, abreEn: null, msHastaAbre: abreMs ?? 0 })
      setLoading(false)
      return
    }

    const fechaStr = targetFecha.toISOString().split('T')[0]
    const { data: partido } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana')
      .eq('fecha', fechaStr)
      .single()

    if (!partido) {
      setVentana({ abierta: true, partido: null, abreEn: null, msHastaAbre: 0 })
      setLoading(false)
      return
    }

    setVentana({ abierta: true, partido, abreEn: null, msHastaAbre: 0 })

    const { data: ins } = await supabase
      .from('inscripciones')
      .select('id, player_id, estado, posicion_espera, profiles(username)')
      .eq('partido_id', partido.id)
      .order('estado', { ascending: true })
      .order('posicion_espera', { ascending: true, nullsFirst: false })

    setInscripciones((ins as Inscripcion[]) ?? [])
    setMiInscripcion((ins as Inscripcion[])?.find(i => i.player_id === u.id) ?? null)
    setLoading(false)
  }, [supabase, calcularVentana])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u)
      if (u) cargarDatos(u)
      else setLoading(false)
    })
  }, [supabase, cargarDatos])

  // Countdown timer
  useEffect(() => {
    if (!ventana?.msHastaAbre) return
    const interval = setInterval(() => {
      const ms = ventana.msHastaAbre - (Date.now() - Date.now())
      // Recalcular
      const { abreMs } = calcularVentana()
      if (!abreMs || abreMs <= 0) { clearInterval(interval); return }
      const h = Math.floor(abreMs / 3600000)
      const m = Math.floor((abreMs % 3600000) / 60000)
      const s = Math.floor((abreMs % 60000) / 1000)
      setCountdown(`${h}h ${m}m ${s}s`)
    }, 1000)
    return () => clearInterval(interval)
  }, [ventana, calcularVentana])

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

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const confirmados = inscripciones.filter(i => i.estado === 'confirmado')
  const enEspera = inscripciones.filter(i => i.estado === 'espera')
  const cuposLibres = 14 - confirmados.length

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
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="display" style={{ fontSize: 20, letterSpacing: '0.1em' }}>MBA FC</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {profile?.role === 'admin' && (
              <Link href="/admin" className="mono" style={{ fontSize: 12, color: 'var(--amber)', letterSpacing: '0.08em', textDecoration: 'none' }}>
                ADMIN ↗
              </Link>
            )}
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{profile?.username}</span>
            <button onClick={cerrarSesion} className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 11 }}>Salir</button>
          </div>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 48 }}>
        {/* Header */}
        <Header />

        <div style={{ height: 48 }} />

        {/* Estado ventana */}
        {!ventana?.abierta ? (
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
                  <strong style={{ color: confirmados.length >= 14 ? 'var(--red)' : 'var(--green)' }}>{confirmados.length}</strong>
                  <span style={{ color: 'var(--text-dim)' }}>/14</span>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 4 }}>
                {Array.from({ length: 14 }, (_, i) => (
                  <div key={i} style={{
                    height: 8, borderRadius: 2,
                    background: i < confirmados.length ? 'var(--green)' : 'var(--border-light)'
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
                    {miInscripcion.estado === 'confirmado' ? '✓ CONFIRMADO' : `ESPERA #${miInscripcion.posicion_espera}`}
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

            {/* Lista de jugadores */}
            {inscripciones.length > 0 && (
              <div style={{ marginTop: 40 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 16 }}>
                  JUGADORES — {confirmados.length} CONFIRMADOS
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
                      {enEspera.map((ins) => (
                        <div key={ins.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 16px', background: 'var(--bg-card)', borderRadius: 3,
                          border: ins.player_id === user.id ? '1px solid #92400e' : '1px solid transparent',
                          opacity: 0.7
                        }}>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', width: 20 }}>#{ins.posicion_espera}</span>
                          <span style={{ fontSize: 15 }}>{ins.profiles.username}</span>
                          {ins.player_id === user.id && (
                            <span className="mono" style={{ fontSize: 10, color: 'var(--amber)', letterSpacing: '0.1em' }}>TÚ</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
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

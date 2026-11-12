'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { MSG } from '@/lib/design'
import { useClub } from '@/hooks/useClub'
import { TabPartidos } from '@/components/admin/tabs/TabPartidos'
import { TabEquipos } from '@/components/admin/tabs/TabEquipos'
import { TabJugadores } from '@/components/admin/tabs/TabJugadores'
import { TabLog } from '@/components/admin/tabs/TabLog'
import { TabHistorial } from '@/components/admin/tabs/TabHistorial'
import { TabNotifs } from '@/components/admin/tabs/TabNotifs'
import { TabAjustes } from '@/components/admin/tabs/TabAjustes'
import { TabFondo } from '@/components/admin/tabs/TabFondo'
import { CierrePartidoCard } from '@/components/admin/CierrePartidoCard'
import type { Player, Partido, AdminAction } from '@/types/admin'

type Tab = 'partidos' | 'equipos' | 'jugadores' | 'log' | 'historial' | 'notifs' | 'ajustes' | 'fondo'

const MAIN_TABS: { id: Tab; label: string }[] = [
  { id: 'partidos',  label: 'partidos' },
  { id: 'equipos',   label: 'equipos' },
  { id: 'jugadores', label: 'jugadores' },
  { id: 'log',       label: 'log' },
]

const MAIN_ICON: Record<string, string> = { partidos: '⚽', equipos: '👥', jugadores: '🧑', log: '📋' }

/** Nombre corto en la cuadrícula: tiene que caber en un cuarto de pantalla. */
const CORTO: Partial<Record<Tab, string>> = {
  partidos: 'Partidos', equipos: 'Equipos', jugadores: 'Jugadores', log: 'Log',
  fondo: 'Fondo', ajustes: 'Ajustes', historial: 'Historial', notifs: 'Avisos',
}

const ICON_TABS: { id: Tab; icon: string; title: string }[] = [
  { id: 'fondo',     icon: '💰', title: 'Fondo MBA' },
  { id: 'ajustes',   icon: '⚙',  title: 'Configuración' },
  { id: 'historial', icon: '🕐', title: 'Historial' },
  { id: 'notifs',    icon: '🔔', title: 'Notificaciones' },
]

export default function AdminPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<Tab>('partidos')
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const club = useClub()
  const [loading, setLoading] = useState(true)
  const [players, setPlayers] = useState<Player[]>([])
  const [playerIdsWithPush, setPlayerIdsWithPush] = useState<Set<string>>(new Set())
  const [partidos, setPartidos] = useState<Partido[]>([])
  const [mensaje, setMensaje] = useState('')
  const [usarUniforme, setUsarUniforme] = useState(true)

  const cargarDatos = useCallback(async () => {
    const [{ data: ps }, pushRes, { data: pts }, settingsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, email, role, baneado, aprobado, uniform, fecha_liberacion, razon_ban, ip_registro, created_at, avatar_url, habilidad, ausente_desde, ausente_hasta')
        .order('created_at', { ascending: false }),
      fetch('/api/admin?accion=push_subs'),
      supabase
        .from('partidos')
        .select('id, fecha, dia_semana, hora, cupos_total, hora_apertura, dias_antes_apertura, inscripciones(estado), invitados(estado), evaluaciones_abiertas, equipos_confirmados, resultado, goles_a, goles_b, notif_apertura_sent, tipo, puntos_blanco, puntos_negro, puntos_morado')
        .gte('fecha', new Date().toISOString().split('T')[0])
        .order('fecha', { ascending: true })
        .limit(8),
      fetch('/api/admin?accion=settings'),
    ])
    setPlayers((ps ?? []) as Player[])
    if (pushRes.ok) {
      const pushJson = await pushRes.json()
      setPlayerIdsWithPush(new Set<string>(pushJson.player_ids ?? []))
    }
    setPartidos((pts ?? []) as Partido[])
    if (settingsRes.ok) {
      const json = await settingsRes.json()
      setUsarUniforme((json.settings ?? {})['usar_uniforme'] !== false)
    }
  }, [supabase])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      const role = (prof as { role?: string } | null)?.role
      if (role !== 'admin' && role !== 'superadmin') { window.location.href = '/'; return }
      setIsSuperAdmin(role === 'superadmin')
      setAuthed(true)
      await cargarDatos()
      setLoading(false)
    })
  }, [supabase, cargarDatos])

  const flash = useCallback((msg: string) => {
    setMensaje(msg)
    setTimeout(() => setMensaje(''), 4000)
  }, [])

  const accionAdmin: AdminAction = useCallback(async (accion, extra) => {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, ...extra }),
    })
    const data = await res.json()
    if (res.ok) {
      flash(data.mensaje ?? 'Hecho.')
      await cargarDatos()
    } else {
      flash(`Error: ${data.error}`)
    }
    return res.ok
  }, [flash, cargarDatos])

  if (authed === null || loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>CARGANDO...</div>
      </div>
    )
  }

  const pendientes = players.filter(p => !p.aprobado && !p.baneado && p.role !== 'admin')

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0', position: 'sticky', top: 0, zIndex: 30, background: 'var(--bg)' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
            <span className="display" style={{ fontSize: 20, letterSpacing: '0.1em', color: 'var(--amber)' }}>ADMIN</span>
          </div>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>{(club?.nombre ?? 'FÚTBOL CLUB').toUpperCase()}</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 40 }}>

        {/* Flash message */}
        {mensaje && (
          <div className="mono fade-in" style={{
            fontSize: 13, padding: '12px 16px', borderRadius: 10, marginBottom: 24,
            ...(mensaje.startsWith('Error') ? MSG.error : MSG.ok),
          }}>
            {mensaje}
          </div>
        )}

        {/* Access requests — always visible on any tab */}
        {pendientes.length > 0 && (
          <div className="fade-in" style={{
            background: '#130f00', border: '1px solid #5a4200',
            borderRadius: 6, padding: '18px 20px', marginBottom: 36,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🔔</span>
              <div className="mono" style={{ fontSize: 12, letterSpacing: '0.15em', color: 'var(--amber)' }}>
                SOLICITUDES DE ACCESO — {pendientes.length}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pendientes.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', background: 'var(--bg-card)',
                  border: '1px solid #3a2800', borderRadius: 10, flexWrap: 'wrap', gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <PlayerAvatar url={p.avatar_url} username={p.username} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>{p.username}</div>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        {p.email}
                        {p.ip_registro && <span style={{ marginLeft: 6 }}>· {p.ip_registro}</span>}
                        <span style={{ marginLeft: 6 }}>
                          · {new Date(p.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => accionAdmin('aprobar_jugador', { player_id: p.id })}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '8px 18px', color: 'var(--primary)', borderColor: 'var(--primary-line)' }}
                    >
                      ✓ Aprobar
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`¿Rechazar y eliminar la solicitud de ${p.username}?`))
                          accionAdmin('rechazar_jugador', { player_id: p.id })
                      }}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '8px 14px', color: 'var(--red)', borderColor: 'var(--neg-line)' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Match close-out — "¿Se jugó?", score, photo. Always visible, never behind a tab. */}
        <CierrePartidoCard onDone={cargarDatos} />

        {/* Navegación: una cuadrícula de 4×2 con icono y nombre, todo a la
            vista. Antes eran dos filas: cuatro iconos sin nombre (nadie sabía
            que 💰 era el Fondo hasta tocarlo) y pestañas de texto que se salían
            de la pantalla sin aviso ("LOG" no se veía en un celular). */}
        <nav aria-label="Secciones del panel" style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 32,
        }}>
          {[...MAIN_TABS.map(t => ({ id: t.id, icon: MAIN_ICON[t.id], title: t.label })), ...ICON_TABS].map(({ id, icon, title }) => {
            const sel = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={sel ? 'page' : undefined}
                style={{
                  minHeight: 56, padding: '6px 2px', borderRadius: 10, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  background: sel ? 'var(--primary-soft)' : 'var(--bg-card)',
                  border: `1px solid ${sel ? 'var(--primary-line)' : 'var(--border)'}`,
                  color: sel ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
                <span style={{ fontSize: 12, fontWeight: sel ? 600 : 400, whiteSpace: 'nowrap' }}>{CORTO[id] ?? title}</span>
              </button>
            )
          })}
        </nav>

        {/* Tab content — conditional render keeps state isolated per tab */}
        {tab === 'partidos' && (
          <TabPartidos
            partidos={partidos}
            players={players}
            accionAdmin={accionAdmin}
            onFlash={flash}
            onRecargarPartidos={cargarDatos}
            onPartidoDeleted={id => setPartidos(prev => prev.filter(p => p.id !== id))}
            onPartidoChanged={cargarDatos}
          />
        )}
        {tab === 'equipos' && (
          <TabEquipos
            partidos={partidos}
            accionAdmin={accionAdmin}
            onFlash={flash}
            onRecargarPartidos={cargarDatos}
          />
        )}
        {tab === 'jugadores' && (
          <TabJugadores
            players={players}
            playerIdsWithPush={playerIdsWithPush}
            accionAdmin={accionAdmin}
            isSuperAdmin={isSuperAdmin}
            usarUniforme={usarUniforme}
          />
        )}
        {tab === 'log'       && <TabLog active />}
        {tab === 'historial' && <TabHistorial active />}
        {tab === 'notifs'    && <TabNotifs partidos={partidos} players={players} onFlash={flash} />}
        {tab === 'ajustes'   && <TabAjustes active isSuperAdmin={isSuperAdmin} />}
        {tab === 'fondo'     && <TabFondo players={players} onFlash={flash} />}

        {/* Version footer */}
        <div style={{ textAlign: 'center', padding: '48px 0 16px' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.08em', opacity: 0.5 }}>
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { FormLabel } from '@/components/FormLabel'
import { ButtonGroup } from '@/components/ButtonGroup'
import { ModalOverlay } from '@/components/ModalOverlay'
import type { Player, Partido, Inscripcion, Invitado, AdminAction } from '@/types/admin'
import { gameNumber, gameString } from '@/lib/gameConfig'
import {
  programaApertura, programaRecordatorio, fechaHoraCO, fechaHoraCortaCO,
  type ProgramaNotif,
} from '@/lib/notifHorario'

/** Venue selector: saved list + "Otro…" free text. */
function LugarPicker({ ubicaciones, value, custom, onValue, onCustom }: {
  ubicaciones: string[]
  value: string
  custom: boolean
  onValue: (v: string) => void
  onCustom: (c: boolean) => void
}) {
  return (
    <div>
      <FormLabel label="Lugar" />
      <select
        value={custom ? '__otro__' : value}
        onChange={e => {
          if (e.target.value === '__otro__') { onCustom(true); onValue('') }
          else { onCustom(false); onValue(e.target.value) }
        }}
        style={{ width: '100%', boxSizing: 'border-box' }}
      >
        {ubicaciones.map(u => <option key={u} value={u}>{u}</option>)}
        <option value="__otro__">Otro…</option>
      </select>
      {custom && (
        <input
          type="text"
          value={value}
          placeholder="Nombre de la cancha"
          onChange={e => onValue(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 8 }}
        />
      )}
    </div>
  )
}

/** "29 sep" — sin toLocaleDateString, por lo mismo que en lib/notifHorario. */
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fechaCortaPartido = (fecha: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  return m ? `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1]}` : fecha
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/**
 * "9 partidos, todos los martes, hasta el 24 nov."
 *
 * Se calcula igual que en el servidor (sumando días en UTC sobre la fecha
 * pelada) para que lo que promete el formulario sea lo que termina creándose.
 */
function resumenRepeticion(fecha: string, semanas: number, ocupadas: Set<string>): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Elige primero la fecha del primero.'
  const n = Math.max(0, Math.min(26, Math.floor(semanas)))
  const base = new Date(fecha + 'T00:00:00Z')
  if (Number.isNaN(base.getTime())) return ''
  const dia = DIAS_SEMANA[base.getUTCDay()]
  const fechas = Array.from({ length: n + 1 }, (_, i) =>
    new Date(base.getTime() + i * 7 * 86400000).toISOString().slice(0, 10))
  if (n === 0) return `Solo el ${dia} ${fechaCortaPartido(fecha)}.`

  // Las repeticiones saltan las fechas que ya tienen partido, así que no hay
  // que borrar nada antes: se puede repetir sobre un calendario a medio hacer.
  const saltadas = fechas.slice(1).filter(f => ocupadas.has(f)).length
  const creados = n + 1 - saltadas
  return `${creados} partido${creados !== 1 ? 's' : ''} nuevo${creados !== 1 ? 's' : ''}: ` +
    `todos los ${dia}, del ${fechaCortaPartido(fecha)} ` +
    `al ${fechaCortaPartido(fechas[fechas.length - 1])}.` +
    (saltadas > 0
      ? saltadas === 1
        ? ' 1 fecha ya tiene partido y se deja como está.'
        : ` ${saltadas} fechas ya tienen partido y se dejan como están.`
      : '')
}

/** "automático" vs "a mano": el admin necesita saber si él puso esa hora. */
const etiquetaPrograma = (pr: ProgramaNotif) => pr.automatica ? '(automático)' : '(a mano)'

// Notification fires 5 min before the inscription window opens.
function notifTime(horaApertura: string): string {
  const [h, m] = horaApertura.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return ''
  let total = h * 60 + m - 5
  if (total < 0) total += 24 * 60
  const hh = Math.floor(total / 60), mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

interface Props {
  partidos: Partido[]
  players: Player[]
  accionAdmin: AdminAction
  onFlash: (msg: string) => void
  onRecargarPartidos: () => Promise<void>
  /** notify parent when a partido is deleted so it can remove it from list */
  onPartidoDeleted: (id: string) => void
  /** notify parent when a partido is created/edited so it can refresh */
  onPartidoChanged: () => Promise<void>
}

export function TabPartidos({ partidos, players, accionAdmin, onFlash, onRecargarPartidos, onPartidoDeleted, onPartidoChanged }: Props) {
  const supabase = createClient()

  // Inscripciones panel
  const [selectedPartido, setSelectedPartido] = useState<string | null>(null)
  const selectedPartidoRef = useRef<string | null>(null)
  selectedPartidoRef.current = selectedPartido
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([])
  const [invitados, setInvitados] = useState<Invitado[]>([])
  const [confirmandoInvitado, setConfirmandoInvitado] = useState<string | null>(null)

  // Game-config defaults (per club, superadmin-set; falls back to GAME_CONFIG defs)
  const [gameCfg, setGameCfg] = useState<Record<string, unknown>>({})
  useEffect(() => {
    fetch('/api/admin?accion=settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.settings) setGameCfg(d.settings) })
      .catch(err => console.error('[TabPartidos] settings fetch failed:', err))
  }, [])
  // Venues: one per line in settings, first = default
  const ubicaciones = String(gameCfg['ubicaciones'] ?? 'Maracaná, Cali').split('\n').map(s => s.trim()).filter(Boolean)
  const defLugar = () => ubicaciones[0] ?? 'Maracaná, Cali'

  const defCupos = () => String(gameNumber(gameCfg, 'cupos_default'))
  const defCuposMini = () => String(gameNumber(gameCfg, 'cupos_minitorneo'))
  const defHora = () => gameString(gameCfg, 'hora_partido_default')
  const defHoraApertura = () => gameString(gameCfg, 'hora_apertura_default')
  const defDiasAntes = () => String(gameNumber(gameCfg, 'dias_antes_default'))

  // Crear/editar partido
  const [crearModal, setCrearModal] = useState(false)
  const [editPartidoModal, setEditPartidoModal] = useState<Partido | null>(null)
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [nuevaHora, setNuevaHora] = useState('19:00')
  const [nuevosCupos, setNuevosCupos] = useState('14')
  const [nuevaHoraApertura, setNuevaHoraApertura] = useState('10:00')
  const [nuevosDiasAntes, setNuevosDiasAntes] = useState('2')
  const [nuevoTipo, setNuevoTipo] = useState<'normal' | 'minitorneo'>('normal')
  const [nuevoLugar, setNuevoLugar] = useState('')
  const [lugarCustom, setLugarCustom] = useState(false)
  const [repetirSemanal, setRepetirSemanal] = useState(false)
  const [repetirSemanas, setRepetirSemanas] = useState('8')
  const [notifAperturaAt, setNotifAperturaAt] = useState('')
  const [notifRecordatorioAt, setNotifRecordatorioAt] = useState('')

  // Inline notif edit
  const [editNotifPartidoId, setEditNotifPartidoId] = useState<string | null>(null)
  const [editNotifAperturaAt, setEditNotifAperturaAt] = useState('')
  const [editNotifRecordatorioAt, setEditNotifRecordatorioAt] = useState('')

  // Modales de inscripciones
  const [promoverModal, setPromoverModal] = useState<Inscripcion | null>(null)
  const [swapPlayerId, setSwapPlayerId] = useState('')
  const [agregarModal, setAgregarModal] = useState(false)
  const [agregarPlayerId, setAgregarPlayerId] = useState('')
  const [agregarEstado, setAgregarEstado] = useState<'confirmado' | 'espera'>('confirmado')

  const cargarInscripciones = useCallback(async (partidoId: string) => {
    const { data } = await supabase
      .from('inscripciones')
      .select('id, estado, posicion_espera, partido_id, created_at, profiles!player_id(username, id), partidos(fecha, dia_semana), added_by_profile:profiles!added_by(username)')
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

  useEffect(() => {
    if (selectedPartido) cargarInscripciones(selectedPartido)
  }, [selectedPartido, cargarInscripciones])

  /** Wraps accionAdmin to also reload inscripciones when a partido is selected */
  const accionAdminLocal: AdminAction = useCallback(async (accion, extra) => {
    const ok = await accionAdmin(accion, extra)
    if (ok && selectedPartidoRef.current) await cargarInscripciones(selectedPartidoRef.current)
    return ok
  }, [accionAdmin, cargarInscripciones])

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
        onFlash('Invitado removido.')
      } else {
        const data = await res.json()
        onFlash(`Error: ${data.error}`)
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
      onFlash(data.mensaje ?? 'Invitado confirmado.')
    } else {
      onFlash(`Error: ${data.error}`)
    }
    setConfirmandoInvitado(null)
  }

  const copiarLista = () => {
    const p = partidos.find(x => x.id === selectedPartido)
    if (!p) return

    const [hStr, mStr] = (p.hora ?? '19:00').split(':')
    const h = parseInt(hStr ?? '19')
    const m = mStr ?? '00'
    const horaFmt = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m} ${h >= 12 ? 'pm' : 'am'}`
    const dia = p.dia_semana.charAt(0).toUpperCase() + p.dia_semana.slice(1)

    const confirmados = inscripciones.filter(i => i.estado === 'confirmado')
    const confirmedInvitados = invitados.filter(inv => inv.estado === 'confirmado')
    const espera = inscripciones.filter(i => i.estado === 'espera')

    const lines: string[] = [`${dia} ${horaFmt}`, '', 'Confirmados:']
    let n = 1
    for (const ins of confirmados) {
      lines.push(`${n}. ${ins.profiles.username}`)
      n++
    }
    for (const inv of confirmedInvitados) {
      lines.push(`${n}. ${inv.nombre} (inv. ${inv.profiles.username})`)
      n++
    }
    if (espera.length > 0) {
      lines.push('', 'Lista Espera:')
      for (const ins of espera) {
        lines.push(`${ins.posicion_espera}. ${ins.profiles.username}`)
      }
    }

    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => onFlash('Lista copiada al portapapeles ✓'))
      .catch(() => onFlash('Error: no se pudo copiar'))
  }

  // El servidor sí crea el primero aunque ese día ya tenga partido (dos
  // partidos el mismo día es válido). Por eso hay que decirlo: si no, quien
  // repite desde una fecha que ya está en el calendario se lleva un duplicado
  // sin haberlo pedido.
  const fechasOcupadas = new Set(partidos.map(x => x.fecha))
  const primeraOcupada = !!nuevaFecha && fechasOcupadas.has(nuevaFecha)

  const crearPartido = async () => {
    if (!nuevaFecha) return
    await accionAdmin('crear_partido', {
      fecha: nuevaFecha,
      hora: nuevaHora + ':00',
      cupos_total: nuevosCupos,
      hora_apertura: nuevaHoraApertura + ':00',
      dias_antes_apertura: nuevosDiasAntes,
      tipo: nuevoTipo,
      lugar: nuevoLugar.trim(),
      notif_apertura_at: notifAperturaAt ? new Date(notifAperturaAt).toISOString() : '',
      notif_recordatorio_at: notifRecordatorioAt ? new Date(notifRecordatorioAt).toISOString() : '',
      // Como el resto del formulario, va en texto: `AdminAction` manda
      // string | boolean y el servidor lo pasa a número al validarlo.
      repetir_semanas: repetirSemanal ? String(Math.max(0, Math.min(26, Number(repetirSemanas) || 0))) : '0',
    })
    setCrearModal(false)
    setNuevaFecha('')
    setRepetirSemanal(false)
    setRepetirSemanas('8')
    setNuevaHora(defHora())
    setNuevosCupos(defCupos())
    setNuevaHoraApertura(defHoraApertura())
    setNuevosDiasAntes(defDiasAntes())
    setNuevoTipo('normal')
    setNotifAperturaAt('')
    setNotifRecordatorioAt('')
    await onPartidoChanged()
  }

  const guardarNotifPartido = async (partidoId: string) => {
    const ok = await accionAdmin('actualizar_notif', {
      partido_id: partidoId,
      notif_apertura_at: editNotifAperturaAt ? new Date(editNotifAperturaAt).toISOString() : '',
      notif_recordatorio_at: editNotifRecordatorioAt ? new Date(editNotifRecordatorioAt).toISOString() : '',
    })
    if (ok) {
      setEditNotifPartidoId(null)
      await onPartidoChanged()
    }
  }

  const abrirEditPartido = (p: Partido) => {
    setEditPartidoModal(p)
    setNuevaFecha(p.fecha)
    setNuevaHora(p.hora?.substring(0, 5) ?? '19:00')
    setNuevosCupos(String(p.cupos_total))
    setNuevaHoraApertura(p.hora_apertura?.substring(0, 5) ?? '10:00')
    setNuevosDiasAntes(String(p.dias_antes_apertura ?? 2))
    setNuevoTipo(p.tipo ?? 'normal')
    const lug = p.lugar ?? defLugar()
    setNuevoLugar(lug)
    setLugarCustom(!ubicaciones.includes(lug))
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
      lugar: nuevoLugar.trim(),
    })
    if (ok) {
      setEditPartidoModal(null)
      await onPartidoChanged()
    }
  }

  const eliminarPartido = async (partidoId: string) => {
    const ok = await accionAdmin('eliminar_partido', { partido_id: partidoId })
    if (ok) {
      onPartidoDeleted(partidoId)
      if (selectedPartido === partidoId) setSelectedPartido(null)
    }
  }
  /**
   * Los inscritos del partido abierto.
   *
   * Se pinta DENTRO de la tarjeta y no en un bloque al final de la pantalla.
   * Antes vivía debajo de toda la lista: con seis partidos ya tocaba scrollear
   * media pantalla para ver a quién se acababa de marcar, y con diez habría
   * quedado absurdamente lejos del partido al que pertenece.
   */
  const panelInscritos = (partidoId: string) => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <SectionHeader title="Inscritos" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(() => {
            const p = partidos.find(x => x.id === partidoId)
            if (!p || p.notif_apertura_sent) return null
            return (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 10, padding: '4px 10px', color: 'var(--amber)', borderColor: '#92400e' }}
                onClick={async () => {
                  const ok = await accionAdmin('forzar_notif_apertura', { partido_id: partidoId })
                  if (ok) await onRecargarPartidos()
                }}
              >
                🔔 Forzar notif apertura
              </button>
            )
          })()}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 10, padding: '4px 10px', color: 'var(--green)', borderColor: '#14532d' }}
            onClick={() => { setAgregarPlayerId(''); setAgregarEstado('confirmado'); setAgregarModal(true) }}
          >
            + Agregar jugador
          </button>
        </div>
      </div>

      {inscripciones.length === 0 ? (
        <Card padding={32} style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin inscripciones aún.</p>
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {inscripciones.map(ins => (
              <div key={ins.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: 'var(--bg-card)',
                border: `1px solid ${ins.estado === 'espera' ? '#1a2a1a' : 'var(--border)'}`, borderRadius: 3,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span className={`badge ${ins.estado === 'confirmado' ? 'badge-green' : 'badge-amber'}`}>
                    {ins.estado === 'confirmado' ? '✓' : `#${ins.posicion_espera}`}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {ins.profiles.username}
                      {ins.added_by_profile && (
                        <span className="mono" style={{ fontSize: 9, color: 'var(--amber)', background: '#1a1500', border: '1px solid #78350f', borderRadius: 2, padding: '1px 5px', letterSpacing: '0.05em' }}>
                          por {ins.added_by_profile.username}
                        </span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                      {new Date(ins.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })}
                      {' · '}
                      {new Date(ins.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  {ins.estado === 'confirmado' && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`¿Mover a ${ins.profiles.username} a lista de espera?`)) return
                        accionAdminLocal('mover_espera', { player_id: ins.profiles.id, partido_id: ins.partido_id })
                      }}
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--amber)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}
                    >
                      EN ESPERA
                    </button>
                  )}
                  {ins.estado === 'espera' && (
                    <button
                      onClick={() => {
                        const p = partidos.find(x => x.id === partidoId)
                        if (!p) return
                        const totalConf = inscripciones.filter(i => i.estado === 'confirmado').length
                          + invitados.filter(i => i.estado === 'confirmado').length
                        if (totalConf >= p.cupos_total) {
                          setSwapPlayerId('')
                          setPromoverModal(ins)
                        } else {
                          if (!window.confirm(`¿Promover a ${ins.profiles.username} a confirmado?`)) return
                          accionAdminLocal('promover_espera_manual', { inscripcion_id: ins.id, partido_id: ins.partido_id })
                        }
                      }}
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}
                    >
                      PROMOVER
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!window.confirm(`¿Remover a ${ins.profiles.username} del partido?`)) return
                      accionAdminLocal('remover_partido', { player_id: ins.profiles.id, partido_id: ins.partido_id })
                    }}
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}
                  >
                    REMOVER
                  </button>
                </div>
              </div>
            ))}

            {/* Confirmed invitados */}
            {invitados.filter(inv => inv.estado === 'confirmado').map(inv => (
              <div key={inv.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: 'var(--bg-card)',
                border: '1px solid #16a34a', borderRadius: 3,
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

          {/* Invitados en espera */}
          {invitados.some(inv => inv.estado === 'espera') && (
            <div style={{ marginTop: 20 }}>
              <SectionHeader
                title="Invitados en Espera"
                count={invitados.filter(inv => inv.estado === 'espera').length}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {invitados.filter(inv => inv.estado === 'espera').map(inv => (
                  <div key={inv.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', background: 'var(--bg-card)',
                    border: '1px solid #1a2a3a', borderRadius: 3, gap: 10,
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

      {/* Copy list button */}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={copiarLista}
          className="btn btn-ghost mono"
          style={{ fontSize: 11, padding: '7px 14px', color: 'var(--text-muted)' }}
        >
          📋 Copiar lista
        </button>
      </div>
    </>
  )

  return (
    <>
      <div id="tab-partidos" className="fade-in">
        <div style={{ maxWidth: 720 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <SectionHeader title="Próximos Partidos" />
            <button
              onClick={() => {
                // Seed form with this club's game-config defaults
                setNuevaHora(defHora())
                setNuevosCupos(defCupos())
                setNuevaHoraApertura(defHoraApertura())
                setNuevosDiasAntes(defDiasAntes())
                setNuevoLugar(defLugar())
                setLugarCustom(false)
                setCrearModal(true)
              }}
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '6px 12px', color: 'var(--green)', borderColor: '#16a34a' }}
            >
              + Nuevo
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {partidos.map(p => {
              const abierto = selectedPartido === p.id
              const cupos = p.cupos_total ?? 14
              let confirmados: number
              let espera: number
              if (abierto) {
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
              const apertura = programaApertura(p, p.notif_apertura_at)
              const recordatorio = programaRecordatorio(p, p.notif_recordatorio_at)

              return (
                <div key={p.id} style={{
                  background: abierto ? 'var(--bg-elevated)' : 'var(--bg-card)',
                  border: `1px solid ${abierto ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius: 4, overflow: 'hidden',
                }}>
                  {/* La tarjeta entera abre y cierra, como en Jugadores. Los
                      botones de editar / notificar / eliminar ya no viven en una
                      columna al lado de cada fila: están adentro, donde se ve a
                      cuál partido se le va a hacer algo. */}
                  <button
                    onClick={() => setSelectedPartido(abierto ? null : p.id)}
                    aria-expanded={abierto}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="display" style={{ fontSize: 18, letterSpacing: '0.05em', color: abierto ? 'var(--green)' : 'var(--text)' }}>
                        {p.dia_semana.toUpperCase()}
                        {p.tipo === 'minitorneo' && <span style={{ fontSize: 12, marginLeft: 6, verticalAlign: 'middle' }}>🟣</span>}
                      </div>
                      <div className="mono" style={{
                        fontSize: 11, color: 'var(--text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {fechaCortaPartido(p.fecha)}
                        {p.lugar && <span style={{ color: 'var(--text-dim)' }}> · 📍 {p.lugar}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="mono" style={{ fontSize: 13 }}>
                        <span style={{ color: confirmados >= cupos ? 'var(--red)' : 'var(--green)' }}>{confirmados}</span>
                        <span style={{ color: 'var(--text-dim)' }}>/{cupos}</span>
                      </div>
                      {espera > 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>+{espera} espera</div>}
                      {/* Antes decía "🔕 notif pendiente", que se leía como "no
                          hay ninguna". Ahora dice a qué hora sale. */}
                      <div className="mono" style={{ fontSize: 9, color: p.notif_apertura_sent ? 'var(--green)' : 'var(--text-dim)', marginTop: 2 }}>
                        {p.notif_apertura_sent ? '🔔 aviso enviado' : `🔔 ${fechaHoraCortaCO(apertura.cuando)}`}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>
                      {abierto ? '▲' : '▼'}
                    </span>
                  </button>

                  {abierto && (
                    <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => abrirEditPartido(p)}
                          className="btn btn-ghost mono"
                          style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '8px 6px' }}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => {
                            if (editNotifPartidoId === p.id) { setEditNotifPartidoId(null); return }
                            setEditNotifPartidoId(p.id)
                            setEditNotifAperturaAt(p.notif_apertura_at ? new Date(p.notif_apertura_at).toISOString().slice(0, 16) : '')
                            setEditNotifRecordatorioAt(p.notif_recordatorio_at ? new Date(p.notif_recordatorio_at).toISOString().slice(0, 16) : '')
                          }}
                          className="btn btn-ghost mono"
                          style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '8px 6px', color: 'var(--amber)' }}
                        >
                          🔔 Avisos
                        </button>
                        <button
                          onClick={() => { if (window.confirm(`¿Eliminar partido del ${p.dia_semana} ${p.fecha}?`)) eliminarPartido(p.id) }}
                          className="btn btn-ghost mono"
                          style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '8px 6px', color: 'var(--red)' }}
                        >
                          ✕ Eliminar
                        </button>
                      </div>

                      {/* Cuándo salen los dos avisos. Sin override el partido NO
                          se queda sin aviso: sale a la hora calculada, y eso es
                          lo que hay que mostrar. */}
                      {editNotifPartidoId !== p.id && (
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                          <div>📣 Apertura: {fechaHoraCO(apertura.cuando)} {etiquetaPrograma(apertura)}</div>
                          <div>⏰ Recordatorio: {fechaHoraCO(recordatorio.cuando)} {etiquetaPrograma(recordatorio)}</div>
                        </div>
                      )}

                      {editNotifPartidoId === p.id && (
                        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                            Vacío = automático. Apertura sale {fechaHoraCO(programaApertura(p).cuando)} y el
                            recordatorio {fechaHoraCO(programaRecordatorio(p).cuando)}.
                          </div>
                          <div>
                            <label className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>NOTIF. APERTURA</label>
                            <input
                              type="datetime-local"
                              value={editNotifAperturaAt}
                              onChange={e => setEditNotifAperturaAt(e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '6px 8px', fontFamily: 'DM Mono, monospace', fontSize: 12 }}
                            />
                          </div>
                          <div>
                            <label className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>NOTIF. RECORDATORIO</label>
                            <input
                              type="datetime-local"
                              value={editNotifRecordatorioAt}
                              onChange={e => setEditNotifRecordatorioAt(e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '6px 8px', fontFamily: 'DM Mono, monospace', fontSize: 12 }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => guardarNotifPartido(p.id)} className="btn btn-primary mono" style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}>
                              Guardar
                            </button>
                            <button onClick={() => setEditNotifPartidoId(null)} className="btn btn-ghost mono" style={{ fontSize: 11, padding: '6px 10px' }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                        {panelInscritos(p.id)}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {partidos.length === 0 && (
            <Card padding={32} style={{ textAlign: 'center' }}>
              <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>No hay partidos próximos.</p>
            </Card>
          )}
        </div>
      </div>

      {/* Modal Promover con Swap */}
      {promoverModal && (
        <ModalOverlay>
          <Card style={{ width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Partido lleno — elegir swap</h3>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              Para promover a <strong style={{ color: 'var(--text)' }}>{promoverModal.profiles.username}</strong>, elige quién cede su cupo y pasa a espera:
            </p>
            <select
              value={swapPlayerId}
              onChange={e => setSwapPlayerId(e.target.value)}
              style={{ width: '100%', marginBottom: 20, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontSize: 14 }}
            >
              <option value="">— Selecciona jugador —</option>
              {inscripciones.filter(i => i.estado === 'confirmado').map(i => (
                <option key={i.id} value={i.profiles.id}>{i.profiles.username}</option>
              ))}
            </select>
            <ButtonGroup gap={12}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!swapPlayerId}
                onClick={async () => {
                  if (!swapPlayerId) return
                  const swapUsername = inscripciones.find(i => i.profiles.id === swapPlayerId)?.profiles.username
                  if (!window.confirm(`¿Promover a ${promoverModal.profiles.username} y mover a ${swapUsername} a espera?`)) return
                  const ok = await accionAdminLocal('promover_espera_manual', {
                    inscripcion_id: promoverModal.id,
                    partido_id: promoverModal.partido_id,
                    swap_player_id: swapPlayerId,
                  })
                  if (ok) setPromoverModal(null)
                }}
              >
                Confirmar swap
              </button>
              <button className="btn btn-ghost" onClick={() => setPromoverModal(null)}>Cancelar</button>
            </ButtonGroup>
          </Card>
        </ModalOverlay>
      )}

      {/* Modal Agregar Jugador */}
      {agregarModal && selectedPartido && (
        <ModalOverlay>
          <Card style={{ width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Agregar jugador al partido</h3>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              Quedará registrado que fue añadido por ti como admin.
            </p>
            <div style={{ marginBottom: 16 }}>
              <FormLabel label="Jugador" />
              <select
                value={agregarPlayerId}
                onChange={e => setAgregarPlayerId(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontSize: 14 }}
              >
                <option value="">— Selecciona jugador —</option>
                {players
                  .filter(p => p.aprobado && !p.baneado && !inscripciones.some(i => i.profiles.id === p.id))
                  .map(p => <option key={p.id} value={p.id}>{p.username}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <FormLabel label="Estado" />
              <div style={{ display: 'flex', gap: 8 }}>
                {(['confirmado', 'espera'] as const).map(e => (
                  <button
                    key={e}
                    onClick={() => setAgregarEstado(e)}
                    className="mono"
                    style={{
                      flex: 1, padding: '8px',
                      border: `1px solid ${agregarEstado === e ? (e === 'confirmado' ? '#16a34a' : '#92400e') : 'var(--border)'}`,
                      borderRadius: 3,
                      background: agregarEstado === e ? (e === 'confirmado' ? '#0f2d1a' : '#1a1000') : 'none',
                      color: agregarEstado === e ? (e === 'confirmado' ? 'var(--green)' : 'var(--amber)') : 'var(--text-muted)',
                      cursor: 'pointer', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <ButtonGroup gap={12}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!agregarPlayerId}
                onClick={async () => {
                  if (!agregarPlayerId) return
                  const targetName = players.find(p => p.id === agregarPlayerId)?.username
                  if (!window.confirm(`¿Agregar a ${targetName} como ${agregarEstado}?`)) return
                  const ok = await accionAdminLocal('agregar_jugador_partido', {
                    player_id: agregarPlayerId,
                    partido_id: selectedPartido,
                    estado: agregarEstado,
                  })
                  if (ok) setAgregarModal(false)
                }}
              >
                Agregar
              </button>
              <button className="btn btn-ghost" onClick={() => setAgregarModal(false)}>Cancelar</button>
            </ButtonGroup>
          </Card>
        </ModalOverlay>
      )}

      {/* Modal Crear Partido */}
      {crearModal && (
        <ModalOverlay>
          <Card style={{ width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto' }} padding={24}>
            <h3 className="display" style={{ fontSize: 24, marginBottom: 8 }}>Nuevo partido</h3>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
              El día de la semana se detecta automáticamente de la fecha.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FormLabel label="Tipo" />
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['normal', 'minitorneo'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => { setNuevoTipo(t); setNuevosCupos(t === 'minitorneo' ? defCuposMini() : defCupos()) }}
                      className="btn btn-ghost mono"
                      style={{
                        flex: 1, fontSize: 11, padding: '8px',
                        borderColor: nuevoTipo === t ? (t === 'minitorneo' ? '#7c3aed' : 'var(--green)') : undefined,
                        color: nuevoTipo === t ? (t === 'minitorneo' ? '#a78bfa' : 'var(--green)') : undefined,
                      }}
                    >
                      {t === 'minitorneo' ? '🟣 Minitorneo' : '⚽ Normal'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <FormLabel label="Fecha" />
                <input type="date" value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
              </div>
              <div>
                <FormLabel label="Hora del Partido" />
                <input type="time" value={nuevaHora} onChange={e => setNuevaHora(e.target.value)} />
              </div>
              <div className="form-2col">
                <div style={{ minWidth: 0 }}>
                  <FormLabel label="Abrir Inscripciones" />
                  <input type="time" value={nuevaHoraApertura} onChange={e => setNuevaHoraApertura(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>hora de apertura</div>
                  {notifTime(nuevaHoraApertura) && (
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                      📣 Notif. {notifTime(nuevaHoraApertura)} (5 min antes)
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <FormLabel label="Días Antes" />
                  <input type="number" min="0" max="7" value={nuevosDiasAntes} onChange={e => setNuevosDiasAntes(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>días previos al partido</div>
                </div>
              </div>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                  CUPOS {nuevoTipo === 'minitorneo' && <span style={{ color: '#a78bfa' }}>(3 × 7)</span>}
                </label>
                <input type="number" min="1" max="30" value={nuevosCupos} onChange={e => setNuevosCupos(e.target.value)} />
              </div>
              <LugarPicker ubicaciones={ubicaciones} value={nuevoLugar} custom={lugarCustom} onValue={setNuevoLugar} onCustom={setLugarCustom} />
              {/* Repetir semanal. El club juega los mismos días todas las
                  semanas y crearlos de a uno era la tarea manual que más se
                  repetía. Las fechas las calcula el servidor. */}
              {primeraOcupada && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--amber)', lineHeight: 1.6, padding: '10px 12px', background: '#1c1503', border: '1px solid #4d3a10', borderRadius: 4 }}>
                  ⚠️ Ya hay un partido el {fechaCortaPartido(nuevaFecha)}. Este se crea igual y quedan dos ese día.
                </div>
              )}

              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '12px 14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={repetirSemanal}
                    onChange={e => setRepetirSemanal(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--green)', cursor: 'pointer' }}
                  />
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>🔁 Repetir cada semana</span>
                </label>
                {repetirSemanal && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="number" min="1" max="26" value={repetirSemanas}
                        onChange={e => setRepetirSemanas(e.target.value)}
                        style={{ width: 80 }}
                      />
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>semanas más</span>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
                      {resumenRepeticion(nuevaFecha, Number(repetirSemanas) || 0, fechasOcupadas)}
                    </div>
                  </div>
                )}
              </div>

              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6, padding: '10px 12px', background: 'var(--surface)', borderRadius: 4 }}>
                📣 Las notificaciones se envían automáticamente: apertura 5 min antes de abrir inscripciones, recordatorio el día del partido. Ajústalas por partido con el botón 🔔.
              </div>
            </div>
            <ButtonGroup gap={12} marginTop={24}>
              <button onClick={crearPartido} disabled={!nuevaFecha} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                {nuevoTipo === 'minitorneo' ? '🟣 Crear minitorneo' : 'Crear partido'}
              </button>
              <button onClick={() => { setCrearModal(false); setNuevoTipo('normal') }} className="btn btn-ghost">Cancelar</button>
            </ButtonGroup>
          </Card>
        </ModalOverlay>
      )}

      {/* Modal Editar Partido */}
      {editPartidoModal && (
        <ModalOverlay>
          <Card style={{ width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto' }} padding={24}>
            <h3 className="display" style={{ fontSize: 24, marginBottom: 8 }}>Editar partido</h3>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
              {editPartidoModal.dia_semana.toUpperCase()} · {editPartidoModal.fecha}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FormLabel label="Fecha" />
                <input type="date" value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
              </div>
              <div>
                <FormLabel label="Hora del Partido" />
                <input type="time" value={nuevaHora} onChange={e => setNuevaHora(e.target.value)} />
              </div>
              <div className="form-2col">
                <div style={{ minWidth: 0 }}>
                  <FormLabel label="Hora Apertura" />
                  <input type="time" value={nuevaHoraApertura} onChange={e => setNuevaHoraApertura(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                  {notifTime(nuevaHoraApertura) && (
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                      📣 Notif. {notifTime(nuevaHoraApertura)} (5 min antes)
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <FormLabel label="Días Antes" />
                  <input type="number" min="0" max="7" value={nuevosDiasAntes} onChange={e => setNuevosDiasAntes(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <FormLabel label="Cupos" />
                <input type="number" min="1" max="30" value={nuevosCupos} onChange={e => setNuevosCupos(e.target.value)} />
              </div>
              <LugarPicker ubicaciones={ubicaciones} value={nuevoLugar} custom={lugarCustom} onValue={setNuevoLugar} onCustom={setLugarCustom} />
            </div>
            <ButtonGroup gap={12} marginTop={24}>
              <button onClick={editarPartido} disabled={!nuevaFecha} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Guardar cambios
              </button>
              <button onClick={() => setEditPartidoModal(null)} className="btn btn-ghost">Cancelar</button>
            </ButtonGroup>
          </Card>
        </ModalOverlay>
      )}
    </>
  )
}

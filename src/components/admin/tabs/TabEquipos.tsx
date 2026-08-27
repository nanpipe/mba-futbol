'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
} from '@dnd-kit/core'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { DraggablePlayerCard } from '@/components/admin/DraggablePlayerCard'
import { DroppableZone } from '@/components/admin/DroppableZone'
import { colorLabel } from '@/lib/design'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import { ButtonGroup } from '@/components/ButtonGroup'
import type { Partido, JugadorEquipo, RotacionEquipo, AdminAction } from '@/types/admin'

interface Props {
  partidos: Partido[]
  accionAdmin: AdminAction
  onFlash: (msg: string) => void
  onRecargarPartidos: () => Promise<void>
}

export function TabEquipos({ partidos, accionAdmin, onFlash, onRecargarPartidos }: Props) {
  const [equiposPartido, setEquiposPartido] = useState<Partido | null>(null)
  const [equipoA, setEquipoA] = useState<JugadorEquipo[]>([])
  const [equipoB, setEquipoB] = useState<JugadorEquipo[]>([])
  const [equipoC, setEquipoC] = useState<JugadorEquipo[]>([])
  const [equiposConfirmado, setEquiposConfirmado] = useState(false)
  const [equiposLoading, setEquiposLoading] = useState(false)
  const [equiposDraft, setEquiposDraft] = useState(false)
  const [golesA, setGolesA] = useState('')
  const [golesB, setGolesB] = useState('')
  const [puntosBlanco, setPuntosBlanco] = useState('')
  const [puntosNegro, setPuntosNegro] = useState('')
  const [puntosMoredo, setPuntosMoredo] = useState('')
  const [evaluacionesAbiertas, setEvaluacionesAbiertas] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [rotacionA, setRotacionA] = useState<RotacionEquipo | null>(null)
  const [rotacionB, setRotacionB] = useState<RotacionEquipo | null>(null)
  const [savingRotacion, setSavingRotacion] = useState(false)
  const [balancerRazon, setBalancerRazon] = useState('')
  const [balancerSource, setBalancerSource] = useState<'gemini' | 'fallback' | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  // Player reactions to the suggested lineup, shown while reviewing the draft.
  const [votos, setVotos] = useState<{ aFavor: number; enContra: number; total: number; comentarios: { username: string; comentario: string }[] } | null>(null)
  const [feedbackHistory, setFeedbackHistory] = useState<{ id: string; feedback: string; created_at: string }[]>([])
  const [savingFeedback, setSavingFeedback] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const cargarFeedback = useCallback(async () => {
    const res = await fetch('/api/balancer-feedback')
    if (res.ok) {
      const data = await res.json()
      setFeedbackHistory(data.feedback ?? [])
    }
  }, [])

  const cargarEquipos = useCallback(async (partido: Partido) => {
    setEquiposLoading(true)
    setEquiposPartido(partido)
    setEquiposConfirmado(partido.equipos_confirmados ?? false)
    setEvaluacionesAbiertas(partido.evaluaciones_abiertas ?? false)
    if (partido.tipo === 'minitorneo') {
      setPuntosBlanco(partido.puntos_blanco != null ? String(partido.puntos_blanco) : '')
      setPuntosNegro(partido.puntos_negro != null ? String(partido.puntos_negro) : '')
      setPuntosMoredo(partido.puntos_morado != null ? String(partido.puntos_morado) : '')
      setGolesA(''); setGolesB('')
    } else {
      if (partido.goles_a != null && partido.goles_b != null) {
        setGolesA(String(partido.goles_a))
        setGolesB(String(partido.goles_b))
      } else if (partido.resultado) {
        const m = partido.resultado.match(/^(\d+)-(\d+)$/)
        if (m) { setGolesA(m[1]); setGolesB(m[2]) } else { setGolesA(''); setGolesB('') }
      } else { setGolesA(''); setGolesB('') }
      setPuntosBlanco(''); setPuntosNegro(''); setPuntosMoredo('')
    }
    setEquiposDraft(false)
    const res = await fetch(`/api/equipos?partido_id=${partido.id}`)
    const data = await res.json()
    if (data.equipos) {
      const ea = data.equipos.find((e: { nombre: string }) => e.nombre === 'A')
      const eb = data.equipos.find((e: { nombre: string }) => e.nombre === 'B')
      const ec = data.equipos.find((e: { nombre: string }) => e.nombre === 'C')
      setEquipoA(ea?.jugadores ?? [])
      setEquipoB(eb?.jugadores ?? [])
      setEquipoC(ec?.jugadores ?? [])
      setRotacionA(ea ? { equipo_id: ea.id, color: ea.color ?? 'blanco', porteroFijo: ea.portero_fijo ?? false, porteroFijoId: ea.portero_fijo_id ?? '', rotacionBanca: ea.rotacion_banca ?? [], rotacionPortero: ea.rotacion_portero ?? [] } : null)
      setRotacionB(eb ? { equipo_id: eb.id, color: eb.color ?? 'negro', porteroFijo: eb.portero_fijo ?? false, porteroFijoId: eb.portero_fijo_id ?? '', rotacionBanca: eb.rotacion_banca ?? [], rotacionPortero: eb.rotacion_portero ?? [] } : null)
    } else {
      setEquipoA([]); setEquipoB([]); setEquipoC([])
      setRotacionA(null); setRotacionB(null)
    }
    setEquiposLoading(false)
  }, [])

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null)
    const { active, over } = event
    if (!over) return
    const fromEquipo = active.data.current?.equipo as 'A' | 'B' | 'C'
    const overId = over.id as string
    const toEquipo: 'A' | 'B' | 'C' = overId === 'equipo-A' ? 'A' : overId === 'equipo-C' ? 'C' : 'B'
    if (fromEquipo === toEquipo) return
    const playerId = active.id as string
    const getSet = (t: 'A' | 'B' | 'C') => t === 'A' ? equipoA : t === 'B' ? equipoB : equipoC
    const setSet = (t: 'A' | 'B' | 'C') => t === 'A' ? setEquipoA : t === 'B' ? setEquipoB : setEquipoC
    const player = getSet(fromEquipo).find(p => p.id === playerId)
    if (!player) return
    setSet(fromEquipo)(getSet(fromEquipo).filter(p => p.id !== playerId))
    setSet(toEquipo)([...getSet(toEquipo), player])
    setEquiposDraft(true)
  }

  const balancearAutomatico = async () => {
    if (!equiposPartido) return
    setEquiposLoading(true)
    setBalancerRazon('')
    setBalancerSource(null)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'balancear', partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) {
      setEquipoA(data.equipoA ?? [])
      setEquipoB(data.equipoB ?? [])
      setEquipoC(data.equipoC ?? [])
      setEquiposDraft(true)
      setBalancerRazon(data.razon ?? '')
      setBalancerSource(data.source ?? 'fallback')
    } else {
      onFlash(`Error: ${data.error}`)
    }
    setEquiposLoading(false)
  }

  const guardarEquiposAction = async () => {
    if (!equiposPartido) return
    setEquiposLoading(true)
    const esMinitorneo = equiposPartido.tipo === 'minitorneo'
    const body = esMinitorneo
      ? { accion: 'guardar', partido_id: equiposPartido.id, equipoA, equipoB, equipoC }
      : { accion: 'guardar', partido_id: equiposPartido.id, equipoA, equipoB }
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (res.ok) {
      onFlash(data.mensaje ?? 'Guardado.')
      setEquiposDraft(false)
      setBalancerSource(null)
      setBalancerRazon('')
      await cargarEquipos(equiposPartido)
    } else {
      onFlash(`Error: ${data.error}`)
    }
    setEquiposLoading(false)
  }

  const confirmarEquiposAction = async () => {
    if (!equiposPartido || !confirm('¿Confirmar equipos y notificar a los jugadores?')) return
    setEquiposLoading(true)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'confirmar', partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) { onFlash(data.mensaje ?? 'Confirmado.'); setEquiposConfirmado(true); await onRecargarPartidos() }
    else onFlash(`Error: ${data.error}`)
    setEquiposLoading(false)
  }

  const resetearEquiposAction = async () => {
    if (!equiposPartido || !confirm('¿Eliminar los equipos de este partido?')) return
    setEquiposLoading(true)
    const res = await fetch('/api/equipos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'resetear', partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) {
      onFlash(data.mensaje ?? 'Reseteado.')
      setEquipoA([]); setEquipoB([]); setEquipoC([])
      setEquiposConfirmado(false); setEquiposDraft(false)
      await onRecargarPartidos()
    } else {
      onFlash(`Error: ${data.error}`)
    }
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
    if (res.ok) { onFlash(data.mensaje ?? 'Evaluaciones cerradas.'); setEvaluacionesAbiertas(false); setEquiposPartido(prev => prev ? { ...prev, evaluaciones_abiertas: false } : prev); await onRecargarPartidos() }
    else onFlash(`Error: ${data.error}`)
  }

  const reabrirEvaluacionesAction = async () => {
    if (!equiposPartido || !confirm('¿Reabrir evaluaciones? Los badges de este partido se eliminarán y recalcularán al cerrar.')) return
    const res = await fetch('/api/evaluaciones', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partido_id: equiposPartido.id }) })
    const data = await res.json()
    if (res.ok) { onFlash(data.mensaje ?? 'Reabiertas.'); setEvaluacionesAbiertas(true); setEquiposPartido(prev => prev ? { ...prev, evaluaciones_abiertas: true } : prev) }
    else onFlash(`Error: ${data.error}`)
  }

  const guardarResultadoAction = async () => {
    if (!equiposPartido) return
    if (equiposPartido.tipo === 'minitorneo') {
      const pB = parseInt(puntosBlanco), pN = parseInt(puntosNegro), pM = parseInt(puntosMoredo)
      if ([pB, pN, pM].some(p => isNaN(p) || p < 0)) return
      const resultado = `B${pB}-N${pN}-M${pM}`
      const ok = await accionAdmin('registrar_resultado', { partido_id: equiposPartido.id, puntos_blanco: String(pB), puntos_negro: String(pN), puntos_morado: String(pM) })
      if (ok) setEquiposPartido(prev => prev ? { ...prev, resultado, puntos_blanco: pB, puntos_negro: pN, puntos_morado: pM } : prev)
      return
    }
    const gA = parseInt(golesA), gB = parseInt(golesB)
    if (isNaN(gA) || isNaN(gB) || gA < 0 || gB < 0) return
    const resultado = `${gA}-${gB}`
    const ok = await accionAdmin('registrar_resultado', { partido_id: equiposPartido.id, goles_a: String(gA), goles_b: String(gB) })
    if (ok) setEquiposPartido(prev => prev ? { ...prev, resultado, goles_a: gA, goles_b: gB } : prev)
  }

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
      const goalie = prev.porteroFijo ? prev.porteroFijoId : ''
      const fieldPlayers = goalie ? allUsernames.filter(u => u !== goalie) : allUsernames
      const banca = shuffleArray(fieldPlayers)
      if (prev.porteroFijo) return { ...prev, rotacionBanca: banca, rotacionPortero: [] }
      // Goalie order = bench order shifted by a random non-zero offset, so the
      // same player is never bench AND goalkeeper in the same slot.
      const n = banca.length
      const offset = n > 1 ? 1 + Math.floor(Math.random() * (n - 1)) : 0
      const portero = banca.map((_, i) => banca[(i + offset) % n])
      return { ...prev, rotacionBanca: banca, rotacionPortero: portero }
    })
  }

  const swapColores = () => {
    setRotacionA(prev => prev ? { ...prev, color: prev.color === 'blanco' ? 'negro' : 'blanco' } : prev)
    setRotacionB(prev => prev ? { ...prev, color: prev.color === 'blanco' ? 'negro' : 'blanco' } : prev)
  }

  const cargarVotos = useCallback(async (partidoId: string) => {
    try {
      const res = await fetch(`/api/alineacion-votos?partido_id=${partidoId}`)
      if (!res.ok) { setVotos(null); return }
      const d = await res.json()
      setVotos({ aFavor: d.aFavor ?? 0, enContra: d.enContra ?? 0, total: d.total ?? 0, comentarios: d.comentarios ?? [] })
    } catch { setVotos(null) }
  }, [])

  useEffect(() => {
    if (equiposPartido?.id) cargarVotos(equiposPartido.id)
    else setVotos(null)
  }, [equiposPartido?.id, cargarVotos])

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
    if (res.ok) onFlash(data.mensaje ?? 'Rotaciones guardadas.')
    else onFlash(`Error: ${data.error}`)
    setSavingRotacion(false)
  }

  const guardarFeedback = async () => {
    if (!feedbackText.trim()) return
    setSavingFeedback(true)
    const res = await fetch('/api/balancer-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback: feedbackText.trim() }) })
    if (res.ok) { setFeedbackText(''); await cargarFeedback(); onFlash('Feedback guardado.') }
    else { const data = await res.json(); onFlash(`Error: ${data.error}`) }
    setSavingFeedback(false)
  }

  const eliminarFeedback = async (id: string) => {
    const res = await fetch('/api/balancer-feedback', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (res.ok) await cargarFeedback()
  }

  const activeDragPlayer = [...equipoA, ...equipoB, ...equipoC].find(p => p.id === activeDragId) ?? null

  const RotacionPanel = ({ equipo, rotacion, setRotacion, accent, jugadores }: {
    equipo: 'A' | 'B'
    rotacion: RotacionEquipo
    setRotacion: React.Dispatch<React.SetStateAction<RotacionEquipo | null>>
    accent: string
    jugadores: string[]
  }) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: accent }}>EQUIPO {equipo}</div>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 2,
          background: rotacion.color === 'blanco' ? '#e5e5e5' : '#1a1a1a',
          color: rotacion.color === 'blanco' ? '#111' : '#aaa',
          border: `1px solid ${rotacion.color === 'blanco' ? '#ccc' : '#444'}`,
          fontFamily: 'DM Mono, monospace',
        }}>
          {colorLabel(rotacion.color)}
        </span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={rotacion.porteroFijo}
            onChange={e => setRotacion(p => p ? { ...p, porteroFijo: e.target.checked, porteroFijoId: '' } : p)}
            style={{ width: 14, height: 14, accentColor: accent, cursor: 'pointer' }}
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>🧤 Portero fijo</span>
        </label>
        {rotacion.porteroFijo && (
          <div>
            <select
              value={rotacion.porteroFijoId}
              onChange={e => {
                const g = e.target.value
                setRotacion(p => p ? { ...p, porteroFijoId: g, rotacionBanca: g ? p.rotacionBanca.filter(u => u !== g) : p.rotacionBanca } : p)
              }}
              style={{ fontSize: 12, padding: '6px 10px', marginBottom: 8, width: '100%' }}
            >
              <option value="">— seleccionar portero —</option>
              {jugadores.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            {rotacion.porteroFijoId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: accent === 'var(--green)' ? '#0a1f0f' : '#1a1200', border: `1px solid ${accent === 'var(--green)' ? '#16a34a' : '#92400e'}`, borderRadius: 4, padding: '8px 12px' }}>
                <span style={{ fontSize: 18 }}>🧤</span>
                <div>
                  <div className="mono" style={{ fontSize: 12, color: accent, fontWeight: 600 }}>{rotacion.porteroFijoId}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>portero titular — no rota</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {rotacion.rotacionBanca.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>ROTACIÓN BANCA</div>
          {rotacion.rotacionBanca.map((u, i) => (
            <div key={u} className="mono" style={{ fontSize: 12, color: i === 0 ? accent === 'var(--green)' ? 'var(--amber)' : 'var(--amber)' : 'var(--text-dim)', padding: '3px 0', display: 'flex', gap: 8 }}>
              <span style={{ minWidth: 20, color: 'var(--text-dim)' }}>{i + 1}.</span>
              <span>{u}</span>
              {i === 0 && <span style={{ fontSize: 10, color: 'var(--amber)' }}>← empieza banca</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Presiona 🎲 para generar rotaciones</div>
      )}

      {!rotacion.porteroFijo && rotacion.rotacionPortero.length > 0 && (
        <div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>ROTACIÓN PORTERO</div>
          {rotacion.rotacionPortero.map((u, i) => (
            <div key={u} className="mono" style={{ fontSize: 12, color: i === 0 ? accent : 'var(--text-dim)', padding: '3px 0', display: 'flex', gap: 8 }}>
              <span style={{ minWidth: 20, color: 'var(--text-dim)' }}>{i + 1}.</span>
              <span>{u}</span>
              {i === 0 && <span style={{ fontSize: 10, color: accent }}>← primer portero</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div id="tab-equipos" className="fade-in">
      {/* Match selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        <SectionHeader title="PARTIDO" color="var(--text-muted)" />
        <select
          value={equiposPartido?.id ?? ''}
          onChange={e => { const p = partidos.find(pt => pt.id === e.target.value); if (p) cargarEquipos(p) }}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '8px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}
        >
          <option value="">Seleccionar partido...</option>
          {partidos.map(p => (
            <option key={p.id} value={p.id}>
              {p.dia_semana} {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
              {p.tipo === 'minitorneo' ? ' 🟣' : ''}
              {p.equipos_confirmados ? ' ✓' : ''}
            </option>
          ))}
        </select>
      </div>

      {!equiposPartido ? (
        <Card padding={48} style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Selecciona un partido para gestionar los equipos.</p>
        </Card>
      ) : equiposLoading ? (
        <LoadingSpinner />
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

          {/* Player reactions to the suggested lineup */}
          {votos && (votos.aFavor + votos.enContra) > 0 && (
            <Card padding="12px 16px" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
                  OPINIÓN DE LOS JUGADORES
                </div>
                <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--green)' }}>👍 {votos.aFavor}</span>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--amber)' }}>✋ {votos.enContra}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    ({votos.aFavor + votos.enContra}/{votos.total})
                  </span>
                </div>
              </div>

              {votos.comentarios.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {votos.comentarios.filter(c => c.comentario).map((c, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      padding: '8px 10px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)', borderRadius: 4,
                    }}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', flexShrink: 0 }}>✋ {c.username}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 120 }}>{c.comentario}</span>
                      <button
                        onClick={() => setFeedbackText(prev => prev ? `${prev}
${c.comentario}` : c.comentario)}
                        title="Copiar al feedback del balanceador"
                        className="mono"
                        style={{
                          fontSize: 10, padding: '4px 8px', borderRadius: 3, cursor: 'pointer',
                          background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', flexShrink: 0,
                        }}
                      >
                        ↓ Usar como feedback
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Skill balance */}
          {(equipoA.length > 0 || equipoB.length > 0) && (() => {
            const avgA = equipoA.length ? equipoA.reduce((s, p) => s + (p.habilidad ?? 3), 0) / equipoA.length : 0
            const avgB = equipoB.length ? equipoB.reduce((s, p) => s + (p.habilidad ?? 3), 0) / equipoB.length : 0
            const diff = Math.abs(avgA - avgB)
            return (
              <Card padding="12px 16px" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
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
              </Card>
            )
          })()}

          {/* DnD columns */}
          <DndContext
            sensors={sensors}
            measuring={{ draggable: { measure: (node) => node.getBoundingClientRect() }, droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={e => setActiveDragId(e.active.id as string)}
            onDragEnd={handleDragEnd}
          >
            <div style={{ display: 'grid', gridTemplateColumns: equiposPartido?.tipo === 'minitorneo' ? 'repeat(auto-fit, minmax(120px, 1fr))' : '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--green)', marginBottom: 8 }}>🤍 BLANCO — {equipoA.length}</div>
                <DroppableZone equipo="A" isConfirmado={equiposConfirmado}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {equipoA.map(p => <DraggablePlayerCard key={p.id} jugador={p} equipo="A" confirmado={equiposConfirmado} />)}
                    {equipoA.length === 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0' }}>Arrastra jugadores aquí</div>}
                  </div>
                </DroppableZone>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--amber)', marginBottom: 8 }}>🖤 NEGRO — {equipoB.length}</div>
                <DroppableZone equipo="B" isConfirmado={equiposConfirmado}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {equipoB.map(p => <DraggablePlayerCard key={p.id} jugador={p} equipo="B" confirmado={equiposConfirmado} />)}
                    {equipoB.length === 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0' }}>Arrastra jugadores aquí</div>}
                  </div>
                </DroppableZone>
              </div>
              {equiposPartido?.tipo === 'minitorneo' && (
                <div>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: '#a78bfa', marginBottom: 8 }}>🟣 MORADO — {equipoC.length}</div>
                  <DroppableZone equipo="C" isConfirmado={equiposConfirmado}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {equipoC.map(p => <DraggablePlayerCard key={p.id} jugador={p} equipo="C" confirmado={equiposConfirmado} />)}
                      {equipoC.length === 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0' }}>Arrastra jugadores aquí</div>}
                    </div>
                  </DroppableZone>
                </div>
              )}
            </div>
            <DragOverlay>
              {activeDragPlayer ? (
                <div style={{ padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--green)', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                  <PlayerAvatar url={activeDragPlayer.avatar_url} username={activeDragPlayer.username} size={26} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{activeDragPlayer.username}</div>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Action buttons */}
          {!equiposConfirmado && (
            <ButtonGroup gap={8} style={{ flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={balancearAutomatico} disabled={equiposLoading} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px' }}>
                ⚖️ Balancear automáticamente
              </button>
              <button onClick={guardarEquiposAction} disabled={equiposLoading || !equiposDraft || (equipoA.length + equipoB.length + equipoC.length === 0)} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--green)', borderColor: '#16a34a' }}>
                💾 Guardar borrador
              </button>
              <button onClick={confirmarEquiposAction} disabled={equiposLoading || equiposDraft || (equipoA.length + equipoB.length + equipoC.length === 0)} className="btn btn-primary" style={{ fontSize: 12, padding: '10px 16px' }}>
                ✓ Confirmar y notificar
              </button>
            </ButtonGroup>
          )}
          <div style={{ marginBottom: 28 }}>
            <button onClick={resetearEquiposAction} disabled={equiposLoading} className="mono" style={{ fontSize: 11, padding: '8px 14px', background: 'none', border: '1px solid #7f1d1d', borderRadius: 3, color: '#7f1d1d', cursor: 'pointer', letterSpacing: '0.08em' }}>
              ✕ Resetear equipos
            </button>
          </div>

          {/* Colores + Rotaciones */}
          {(rotacionA || rotacionB) && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>⚽ COLORES Y ROTACIONES</div>
                <ButtonGroup gap={8} style={{ flexWrap: 'wrap' }}>
                  <button onClick={swapColores} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>↔ Cambiar colores</button>
                  <button onClick={() => { aleatorizarRotacion('A'); aleatorizarRotacion('B') }} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px', color: 'var(--amber)', borderColor: '#92400e' }}>
                    🎲 Aleatorizar rotaciones
                  </button>
                  <button onClick={guardarRotaciones} disabled={savingRotacion} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px', color: 'var(--green)', borderColor: '#16a34a' }}>
                    {savingRotacion ? '...' : '💾 Guardar'}
                  </button>
                </ButtonGroup>
              </div>
              <div className="form-2col">
                {rotacionA && <RotacionPanel equipo="A" rotacion={rotacionA} setRotacion={setRotacionA} accent="var(--green)" jugadores={equipoA.map(j => j.username)} />}
                {rotacionB && <RotacionPanel equipo="B" rotacion={rotacionB} setRotacion={setRotacionB} accent="var(--amber)" jugadores={equipoB.map(j => j.username)} />}
              </div>
            </div>
          )}

          {/* Gemini razon + feedback */}
          {balancerSource !== null && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 24 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>
                🤖 BALANCEADOR IA
                {balancerSource === 'gemini' && <span style={{ marginLeft: 8, color: 'var(--green)' }}>· Gemini</span>}
                {balancerSource === 'fallback' && <span style={{ marginLeft: 8, color: 'var(--amber)' }}>· Snake-draft (fallback)</span>}
              </div>
              {balancerRazon && (
                <div style={{ background: '#0a1a0f', border: '1px solid #16a34a', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', lineHeight: 1.6 }}>
                  &ldquo;{balancerRazon}&rdquo;
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <label className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)', display: 'block', marginBottom: 8 }}>
                  FEEDBACK PARA EL PRÓXIMO BALANCEO
                </label>
                <textarea
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  placeholder={'Ej: "Juli y Mauricio no deben ir juntos"\nEj: "Magic y Mati siempre en el mismo equipo"'}
                  rows={3}
                  style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
                />
                <button onClick={guardarFeedback} disabled={savingFeedback || !feedbackText.trim()} className="btn btn-ghost" style={{ marginTop: 8, fontSize: 11, padding: '8px 16px', color: 'var(--green)', borderColor: '#16a34a' }}>
                  {savingFeedback ? 'Guardando...' : '💾 Guardar feedback'}
                </button>
              </div>
              {feedbackHistory.length > 0 && (
                <div>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 8 }}>
                    CONTEXTO ACUMULADO — {feedbackHistory.length} entradas
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                    {feedbackHistory.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3 }}>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', minWidth: 60, paddingTop: 1 }}>
                          {new Date(f.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                        </div>
                        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{f.feedback}</div>
                        <button onClick={() => eliminarFeedback(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7f1d1d', fontSize: 13, lineHeight: 1, flexShrink: 0, padding: '0 4px' }} title="Eliminar">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Resultado */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 24 }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>RESULTADO DEL PARTIDO</div>
            {equiposPartido.tipo === 'minitorneo' ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {([
                  { label: '🤍 Blanco', val: puntosBlanco, set: setPuntosBlanco },
                  { label: '🖤 Negro',  val: puntosNegro,  set: setPuntosNegro },
                  { label: '🟣 Morado', val: puntosMoredo, set: setPuntosMoredo },
                ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
                    <input type="number" min={0} max={999} value={val} onChange={e => set(e.target.value)} placeholder="0" style={{ width: 64, textAlign: 'center' }} />
                  </div>
                ))}
                <button onClick={guardarResultadoAction} disabled={puntosBlanco === '' || puntosNegro === '' || puntosMoredo === ''} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 14px' }}>
                  Guardar puntos
                </button>
                {equiposPartido.resultado && (
                  <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    Guardado: <strong style={{ color: 'var(--text)' }}>{equiposPartido.resultado}</strong>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--green)' }}>
                    {rotacionA ? (rotacionA.color === 'blanco' ? '🤍' : '🖤') : 'A'}
                  </span>
                  <input type="number" min={0} max={99} value={golesA} onChange={e => setGolesA(e.target.value)} placeholder="0" style={{ width: 56, textAlign: 'center' }} />
                </div>
                <span className="mono" style={{ fontSize: 14, color: 'var(--text-dim)' }}>—</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" min={0} max={99} value={golesB} onChange={e => setGolesB(e.target.value)} placeholder="0" style={{ width: 56, textAlign: 'center' }} />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--amber)' }}>
                    {rotacionB ? (rotacionB.color === 'blanco' ? '🤍' : '🖤') : 'B'}
                  </span>
                </div>
                <button onClick={guardarResultadoAction} disabled={golesA === '' || golesB === ''} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 14px' }}>
                  Guardar resultado
                </button>
                {equiposPartido.resultado && (
                  <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    Guardado: <strong style={{ color: 'var(--text)' }}>{equiposPartido.resultado}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Evaluaciones */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>EVALUACIONES ENTRE PARES</div>
            <ButtonGroup gap={8} style={{ flexWrap: 'wrap', marginBottom: 8 }}>
              {!evaluacionesAbiertas ? (
                <>
                  <button onClick={abrirEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--amber)', borderColor: '#92400e' }}>
                    📊 Abrir evaluaciones
                  </button>
                  {equiposPartido?.evaluaciones_abiertas === false && (
                    <button onClick={reabrirEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                      ↩ Reabrir (deshacer cierre)
                    </button>
                  )}
                </>
              ) : (
                <button onClick={cerrarEvaluacionesAction} className="btn btn-ghost" style={{ fontSize: 12, padding: '10px 16px', color: 'var(--red)', borderColor: '#7f1d1d' }}>
                  🏅 Cerrar y calcular badges
                </button>
              )}
            </ButtonGroup>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {evaluacionesAbiertas
                ? 'Los jugadores pueden votar reconocimientos. Al cerrar, se asignan badges.'
                : 'Al abrir, los jugadores confirmados pueden votar reconocimientos entre pares.'}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

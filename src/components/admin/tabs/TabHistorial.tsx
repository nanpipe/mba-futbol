'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { HistorialPartido } from '@/types/admin'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import { ButtonGroup } from '@/components/ButtonGroup'
import { calcularVentanaPartido } from '@/lib/partidos'
import { fechaColombia } from '@/lib/promoHora'
import { cierreAutomatico } from '@/lib/reconocimientos'
import { RecorteFotoModal } from '@/components/admin/RecorteFotoModal'
import { PlayerAvatar } from '@/components/PlayerAvatar'

interface Props {
  active: boolean
}

interface InscripcionHistorial {
  id: string
  estado: string
  player_id: string
  profiles: { username: string; id: string; avatar_url?: string | null }
}

interface PlayerBasic {
  id: string
  username: string
  aprobado: boolean
  baneado: boolean
  role: string
}

async function adminAction(accion: string, extra: Record<string, unknown>): Promise<{ ok: boolean; mensaje?: string; error?: string }> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion, ...extra }),
  })
  return res.json()
}

/**
 * Cuántos entregaron su evaluación. Con la votación abierta es lo que el admin
 * mira para decidir si ya vale la pena cerrar; con la votación cerrada explica
 * por qué hubo (o no hubo) reconocimientos.
 */
function ProgresoVotacion({ progreso, cerrada }: {
  progreso?: { votaron: number; total: number }
  cerrada?: boolean
}) {
  if (!progreso || progreso.total === 0) return null
  const { votaron, total } = progreso
  const pct = Math.round((votaron / total) * 100)
  const color = votaron === total ? 'var(--green)' : votaron >= total / 2 ? 'var(--amber)' : 'var(--text-dim)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, maxWidth: 160, height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>
        {votaron} de {total} {cerrada ? 'votaron' : 'han votado'}
      </span>
    </div>
  )
}

const EQUIPO_LABEL: Record<string, { titulo: string; color: string }> = {
  blanco: { titulo: '🤍 BLANCOS', color: '#e5e5e5' },
  negro: { titulo: '🖤 NEGROS', color: 'var(--text-muted)' },
  morado: { titulo: '💜 MORADOS', color: '#a78bfa' },
}

/**
 * Quiénes jugaron, en rejilla y agrupados por equipo.
 *
 * Antes era una fila por persona con su propio botón REMOVER: catorce filas
 * altas, catorce botones rojos para algo que casi nunca se hace, y el estado
 * "confirmado" repetido catorce veces sin decir nada. Agrupado por equipo se
 * lee de un vistazo con quién jugó cada quien, que es el dato que sí importa
 * y que ya está guardado. Quitar y agregar viven abajo, en un solo control.
 */
function ListaJugadores({ inscripciones, equipoDe }: {
  inscripciones: InscripcionHistorial[]
  equipoDe: Record<string, string>
}) {
  const grupos = new Map<string, InscripcionHistorial[]>()
  for (const ins of inscripciones) {
    // En espera no jugó, así que va aparte aunque tuviera equipo asignado.
    const clave = ins.estado === 'espera' ? 'espera' : (equipoDe[ins.player_id] ?? 'sin')
    const lista = grupos.get(clave)
    if (lista) lista.push(ins)
    else grupos.set(clave, [ins])
  }
  // Orden estable: equipos primero, luego los que no quedaron asignados, y la
  // espera al final.
  const orden = ['blanco', 'negro', 'morado', 'sin', 'espera']
  const claves = [...grupos.keys()].sort((a, b) => orden.indexOf(a) - orden.indexOf(b))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {claves.map(clave => {
        const lista = grupos.get(clave)!
        const meta = EQUIPO_LABEL[clave]
        const titulo = meta?.titulo ?? (clave === 'espera' ? '⏳ EN ESPERA' : 'SIN EQUIPO')
        const color = meta?.color ?? (clave === 'espera' ? 'var(--amber)' : 'var(--text-dim)')
        return (
          <div key={clave}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color, marginBottom: 6 }}>
              {titulo} · {lista.length}
            </div>
            {/* `flex` y no `grid`: con una rejilla de columnas iguales, en
                pantalla ancha cada nombre se estiraba hasta ocupar un cuarto
                de la fila — mucho espacio vacío alrededor de un texto de diez
                caracteres. Así cada ficha mide lo que mide su nombre y se
                empaquetan a la izquierda. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {lista.map(ins => (
                <div key={ins.id} style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '5px 10px 5px 6px', background: 'var(--bg-card)',
                  border: '1px solid var(--border)', borderRadius: 999,
                  opacity: clave === 'espera' ? 0.65 : 1,
                }}>
                  <PlayerAvatar url={ins.profiles.avatar_url ?? null} username={ins.profiles.username} size={20} />
                  <span className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {ins.profiles.username}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function TabHistorial({ active }: Props) {
  const supabase = createClient()
  const [historial, setHistorial] = useState<HistorialPartido[]>([])
  const [loading, setLoading] = useState(false)
  const [flash, setFlash] = useState('')

  // Per-partido expanded management panel
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Inscriptions for expanded match
  const [inscripciones, setInscripciones] = useState<InscripcionHistorial[]>([])
  const [loadingIns, setLoadingIns] = useState(false)

  // Add player
  const [allPlayers, setAllPlayers] = useState<PlayerBasic[]>([])
  const [addPlayerId, setAddPlayerId] = useState('')
  const [addEstado, setAddEstado] = useState<'confirmado' | 'espera'>('confirmado')
  const [savingAdd, setSavingAdd] = useState(false)

  // Result form state
  const [golesA, setGolesA] = useState('')
  const [golesB, setGolesB] = useState('')
  const [ptsBlancos, setPtsBlancos] = useState('')
  const [ptsNegros, setPtsNegros] = useState('')
  const [ptsMorados, setPtsMorados] = useState('')
  const [savingResultado, setSavingResultado] = useState(false)
  const [savingConfirmar, setSavingConfirmar] = useState(false)
  const [savingEval, setSavingEval] = useState(false)
  const [savingCerrar, setSavingCerrar] = useState(false)
  const [quitandoBadge, setQuitandoBadge] = useState<string | null>(null)
  // partido_id → cuántos entregaron su evaluación. Viene del servidor: el
  // cliente ya no puede leer votos_reconocimiento ni player_thumbs.
  const [progreso, setProgreso] = useState<Record<string, { votaron: number; total: number }>>({})
  const [removingId, setRemovingId] = useState<string | null>(null)
  // player_id → color del equipo en que jugó, del partido abierto. Se muestra
  // en vez del estado suelto: saber con quién jugó cada quien es más útil que
  // repetir "confirmado" catorce veces.
  const [equipoDe, setEquipoDe] = useState<Record<string, string>>({})
  // El selector de abajo hace las dos cosas. Antes cada fila llevaba su propio
  // REMOVER, que llenaba la lista de botones rojos para una acción que casi
  // nunca se usa.
  // null = plegado. Los dos botones arrancan en gris y el selector no existe
  // hasta que se toca uno: es una acción ocasional, no tiene por qué ocupar
  // sitio ni pedir atención cada vez que se abre un partido.
  const [modo, setModo] = useState<'agregar' | 'remover' | null>(null)
  // Partido cuyo marcador se está editando. Con resultado ya guardado el
  // formulario permanece escondido: se muestra el dato y un "editar" discreto.
  const [editandoResultado, setEditandoResultado] = useState<string | null>(null)
  const [uploadingFoto, setUploadingFoto] = useState(false)
  // Foto elegida esperando encuadre. Solo se sube lo que sale del recortador.
  const [porRecortar, setPorRecortar] = useState<{ partidoId: string; file: File } | null>(null)

  const showFlash = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3500)
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    // Colombia date, and today's match counts once it's over (kickoff + 1h) —
    // it used to wait until tomorrow to show up here.
    const hoy = fechaColombia()
    const { data } = await supabase
      .from('partidos')
      .select('id, fecha, dia_semana, hora, jugado, resultado, goles_a, goles_b, puntos_blanco, puntos_negro, puntos_morado, equipos_confirmados, evaluaciones_abiertas, foto_url, cupos_total, tipo, inscripciones(estado), player_badges(badge_id, player_id, badge_emoji, badge_nombre, votos, profiles!player_badges_player_id_fkey(username))')
      .lte('fecha', hoy)
      .order('fecha', { ascending: false })
      .limit(30)
    const ahora = new Date()
    setHistorial(((data as unknown as HistorialPartido[]) ?? []).filter(p => ahora >= calcularVentanaPartido(p).termina))

    // No bloquea la lista: si falla, simplemente no se muestra el contador.
    fetch('/api/admin?accion=progreso_votaciones')
      .then(r => r.json())
      .then(d => { if (d?.ok) setProgreso(d.progreso ?? {}) })
      .catch(() => {})

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (active) cargar()
  }, [active, cargar])

  // Fetch all approved players once (for add dropdown)
  useEffect(() => {
    if (!active) return
    supabase
      .from('profiles')
      .select('id, username, aprobado, baneado, role')
      .eq('aprobado', true)
      .eq('baneado', false)
      .order('username')
      .then(({ data }) => setAllPlayers((data as PlayerBasic[]) ?? []))
  }, [active, supabase])

  const cargarInscripciones = useCallback(async (partidoId: string) => {
    setLoadingIns(true)
    const [{ data }, { data: eqj }] = await Promise.all([
      supabase
        .from('inscripciones')
        .select('id, estado, player_id, profiles!player_id(username, id, avatar_url)')
        .eq('partido_id', partidoId)
        .order('estado')
        .order('posicion_espera', { ascending: true, nullsFirst: false }),
      supabase
        .from('equipo_jugadores')
        .select('player_id, equipos!inner(partido_id, color)')
        .eq('equipos.partido_id', partidoId),
    ])
    const porJugador: Record<string, string> = {}
    for (const f of (eqj ?? []) as unknown as { player_id: string; equipos: { color: string | null } | { color: string | null }[] | null }[]) {
      const e = Array.isArray(f.equipos) ? f.equipos[0] : f.equipos
      if (e?.color) porJugador[f.player_id] = e.color
    }
    setEquipoDe(porJugador)
    setInscripciones((data as unknown as InscripcionHistorial[]) ?? [])
    setLoadingIns(false)
  }, [supabase])

  /** Deja el formulario con lo que ya está guardado. */
  const prefillResultado = (p: HistorialPartido) => {
    if (p.tipo === 'minitorneo') {
      setPtsBlancos(p.puntos_blanco != null ? String(p.puntos_blanco) : '')
      setPtsNegros(p.puntos_negro != null ? String(p.puntos_negro) : '')
      setPtsMorados(p.puntos_morado != null ? String(p.puntos_morado) : '')
    } else {
      setGolesA(p.goles_a != null ? String(p.goles_a) : '')
      setGolesB(p.goles_b != null ? String(p.goles_b) : '')
    }
  }

  const handleExpand = (id: string, p: HistorialPartido) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setAddPlayerId('')
    // Abrir otro partido no debe dejar abierto el editor del anterior.
    setEditandoResultado(null)
    cargarInscripciones(id)
    prefillResultado(p)
  }

  const handleConfirmar = async (partido_id: string) => {
    setSavingConfirmar(true)
    // Same action as the "¿Se jugó?" card: marks it played and opens the votes.
    const r = await adminAction('cerrar_partido', { partido_id, jugado: true })
    if (r.ok) {
      await cargar()
      showFlash(r.mensaje ?? 'Partido jugado ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingConfirmar(false)
  }

  const handleResultado = async (p: HistorialPartido) => {
    setSavingResultado(true)
    let r
    if (p.tipo === 'minitorneo') {
      r = await adminAction('registrar_resultado', {
        partido_id: p.id,
        puntos_blanco: parseInt(ptsBlancos) || 0,
        puntos_negro: parseInt(ptsNegros) || 0,
        puntos_morado: parseInt(ptsMorados) || 0,
      })
    } else {
      r = await adminAction('registrar_resultado', {
        partido_id: p.id,
        goles_a: parseInt(golesA) || 0,
        goles_b: parseInt(golesB) || 0,
      })
    }
    if (r.ok) {
      await cargar()
      showFlash(r.mensaje ?? 'Resultado guardado ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingResultado(false)
  }

  /**
   * Cerrar a mano casi nunca hace falta, y el admin no tenía cómo saberlo: veía
   * el botón y asumía que si no lo tocaba, no pasaba nada. El aviso dice cuándo
   * se cierra solo y cuánta gente falta por votar, que es lo que de verdad
   * decide si vale la pena esperar.
   */
  const handleCerrarVotacion = async (partido_id: string) => {
    const p = historial.find(x => x.id === partido_id)
    const c = p ? cierreAutomatico(p.fecha) : null
    const dia = (f: string) =>
      new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    const pr = progreso[partido_id]
    const faltan = pr && pr.total > pr.votaron ? pr.total - pr.votaron : 0

    const aviso = [
      c
        ? `Ojo: NO hace falta cerrarlas a mano.\n\nSe cierran solas el ${dia(c.cierra)} a medianoche, así que todavía queda todo el ${dia(c.ultimoDia)} para votar.`
        : 'Ojo: las votaciones se cierran solas dos días después del partido.',
      faltan > 0
        ? `\nFaltan ${faltan} por votar (van ${pr!.votaron} de ${pr!.total}). Si cierras ahora, los reconocimientos se reparten solo con los votos que ya hay.`
        : '\nYa votaron todos los que jugaron.',
      '\n¿Cerrar de todas formas?',
    ].join('\n')

    if (!window.confirm(aviso)) return
    setSavingCerrar(true)
    const res = await fetch('/api/evaluaciones', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id }),
    })
    const r = await res.json()
    if (res.ok) {
      setHistorial(prev => prev.map(p => p.id === partido_id ? { ...p, evaluaciones_abiertas: false } : p))
      await cargar() // reload to show new badges
      showFlash(r.mensaje ?? 'Votación cerrada ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingCerrar(false)
  }

  // Quitar un reconocimiento que la votación dio por chiste. Deja un veto, así
  // que no vuelve en el siguiente conteo, y recalcula el rating del partido.
  const handleQuitarBadge = async (
    partido_id: string,
    player_id: string,
    badge_id: string,
    etiqueta: string,
  ) => {
    const motivo = window.prompt(
      `Quitar "${etiqueta}".\n\nMotivo (opcional, queda en el log):`,
      ''
    )
    if (motivo === null) return // canceló
    setQuitandoBadge(`${partido_id}:${player_id}:${badge_id}`)
    const r = await adminAction('quitar_badge', { partido_id, player_id, badge_id, motivo })
    if (r.ok) {
      await cargar()
      showFlash(r.mensaje ?? 'Reconocimiento quitado ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setQuitandoBadge(null)
  }

  const handleAbrirEval = async (partido_id: string) => {
    setSavingEval(true)
    const r = await adminAction('abrir_evaluaciones', { partido_id })
    if (r.ok) {
      setHistorial(prev => prev.map(p => p.id === partido_id ? { ...p, evaluaciones_abiertas: true } : p))
      showFlash(r.mensaje ?? 'Evaluaciones abiertas ✓')
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingEval(false)
  }

  const handleRemover = async (ins: InscripcionHistorial, partido_id: string) => {
    if (!window.confirm(`¿Remover a ${ins.profiles.username} del partido?`)) return
    setRemovingId(ins.id)
    const r = await adminAction('remover_partido', { player_id: ins.profiles.id, partido_id })
    if (r.ok) {
      setInscripciones(prev => prev.filter(i => i.id !== ins.id))
      showFlash(`${ins.profiles.username} removido.`)
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setRemovingId(null)
  }

  /**
   * Reencuadrar una foto YA subida, sin volver a buscarla en el carrete.
   *
   * Las fotos anteriores al recorte obligatorio tienen cualquier proporción, y
   * una vertical dentro de la caja 16:9 queda con dos franjas negras enormes.
   * Esto la baja del storage, la mete al mismo recortador y sube el resultado.
   *
   * Se baja con `fetch` y no dibujando la <img> directo: una imagen de otro
   * origen pintada en un canvas lo "contamina" y `toBlob` revienta. El bucket
   * es público y responde con CORS abierto, así que el blob llega como dato
   * local y el canvas queda limpio.
   */
  const reencuadrar = async (partidoId: string, url: string) => {
    setUploadingFoto(true)
    try {
      const res = await fetch(url, { cache: 'reload' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      setPorRecortar({ partidoId, file: new File([blob], 'actual.jpg', { type: blob.type || 'image/jpeg' }) })
    } catch {
      showFlash('No se pudo abrir la foto actual. Vuelve a subirla desde el carrete.')
    } finally {
      setUploadingFoto(false)
    }
  }

  const handleFotoUpload = async (partidoId: string, file: File) => {
    setUploadingFoto(true)
    try {
      // Upload via server (service-role) so it bypasses storage RLS — no more
      // "new row violates row-level security policy".
      const form = new FormData()
      form.append('partido_id', partidoId)
      form.append('file', file)
      const res = await fetch('/api/admin/foto', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.foto_url) {
        setHistorial(prev => prev.map(p => p.id === partidoId ? { ...p, foto_url: data.foto_url } : p))
        showFlash('Foto guardada ✓')
      } else {
        showFlash(`Error: ${data.error ?? 'No se pudo subir la foto'}`)
      }
    } finally {
      setUploadingFoto(false)
    }
  }

  const handleAgregar = async (partido_id: string) => {
    if (!addPlayerId) return
    const name = allPlayers.find(p => p.id === addPlayerId)?.username ?? ''
    if (!window.confirm(`¿Agregar a ${name} como ${addEstado}?`)) return
    setSavingAdd(true)
    const r = await adminAction('agregar_jugador_partido', { player_id: addPlayerId, partido_id, estado: addEstado })
    if (r.ok) {
      await cargarInscripciones(partido_id)
      setAddPlayerId('')
      showFlash(r.mensaje ?? `${name} agregado.`)
    } else {
      showFlash(`Error: ${r.error}`)
    }
    setSavingAdd(false)
  }

  return (
    <div id="tab-historial" className="fade-in">
      {flash && (
        <div className="mono" style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#0f2d1a', border: '1px solid #16a34a', color: 'var(--green)',
          padding: '10px 20px', borderRadius: 3, fontSize: 13, zIndex: 200,
        }}>
          {flash}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
          HISTORIAL — {historial.length} partidos pasados
        </div>
        <button onClick={cargar} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px' }}>↻ Refrescar</button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : historial.length === 0 ? (
        <Card padding={48} style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>No hay partidos pasados registrados.</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {historial.map(p => {
            const confirmados = (p.inscripciones ?? []).filter((i: { estado: string }) => i.estado === 'confirmado').length
            const badges = p.player_badges ?? []
            const esMinitorneo = p.tipo === 'minitorneo'
            const score = esMinitorneo
              ? (p.puntos_blanco != null ? `B${p.puntos_blanco}·N${p.puntos_negro}·M${p.puntos_morado}` : null)
              : (p.goles_a != null && p.goles_b != null ? `${p.goles_a} – ${p.goles_b}` : p.resultado ?? null)
            const isExpanded = expandedId === p.id

            // Players not yet in this match (for add dropdown)
            const inscribedIds = new Set(inscripciones.map(i => i.player_id))
            const availablePlayers = allPlayers.filter(pl =>
              pl.role !== 'admin' && pl.role !== 'superadmin' && !inscribedIds.has(pl.id)
            )

            return (
              <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Header row — click to expand */}
                <button
                  onClick={() => handleExpand(p.id, p)}
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '16px 20px', textAlign: 'left',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
                  }}
                >
                  <div>
                    {/* En verde: es lo que separa un partido del siguiente en
                        una lista larga, y en gris se perdía entre el resto. */}
                    <div className="display" style={{ fontSize: 20, letterSpacing: '0.05em', color: 'var(--green)' }}>
                      {p.dia_semana.toUpperCase()}
                      {esMinitorneo && <span style={{ fontSize: 12, marginLeft: 6, verticalAlign: 'middle' }}>🟣</span>}
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
                        {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{confirmados} jugadores</span>
                      {score
                        ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>🤍 {score} 🖤</span>
                        : <span style={{ color: 'var(--amber)' }}>sin resultado</span>
                      }
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    {p.jugado === true && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--green)', border: '1px solid #16a34a', padding: '2px 8px', borderRadius: 2 }}>JUGADO</span>
                    )}
                    {p.jugado === false && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 2 }}>NO JUGADO</span>
                    )}
                    {p.evaluaciones_abiertas && (
                      <span className="mono" style={{ fontSize: 10, color: '#a78bfa', border: '1px solid #7c3aed', padding: '2px 8px', borderRadius: 2 }}>EVAL ✓</span>
                    )}
                    <span className="mono" style={{ fontSize: 14, color: 'var(--text-dim)' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Badges */}
                {badges.length > 0 && (
                  <div style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: isExpanded ? 0 : 12, maxWidth: '100%', overflowX: 'auto' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {badges.map((b, i) => {
                        const key = `${p.id}:${b.player_id}:${b.badge_id}`
                        const quitando = quitandoBadge === key
                        const etiqueta = `${b.badge_nombre}${b.profiles ? ` · ${b.profiles.username}` : ''}`
                        return (
                          <div key={i} className="mono" style={{ fontSize: 11, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 2, padding: '3px 4px 3px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, opacity: quitando ? 0.5 : 1 }}>
                            <span>
                              {b.badge_emoji} {b.badge_nombre}
                              {b.profiles && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>· {b.profiles.username}</span>}
                              {/* Con cuántos votos ganó: es el dato para decidir si la
                                  votación fue en serio antes de quitarlo. */}
                              {typeof b.votos === 'number' && (
                                <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>· {b.votos}v</span>
                              )}
                            </span>
                            <button
                              onClick={e => { e.stopPropagation(); handleQuitarBadge(p.id, b.player_id, b.badge_id, etiqueta) }}
                              disabled={quitando}
                              title={`Quitar "${etiqueta}"`}
                              aria-label={`Quitar reconocimiento ${etiqueta}`}
                              style={{
                                background: 'none', border: 'none', cursor: quitando ? 'default' : 'pointer',
                                color: 'var(--text-dim)', fontSize: 13, lineHeight: 1, padding: '0 4px',
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Expandable management panel */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* La foto va PRIMERO: es lo que el admin quiere ver al
                        abrir un partido, y estaba de últimas, debajo de los
                        nombres y del marcador. */}
                    {/* ── Foto del partido ── */}
                    <div>
                      <SectionHeader title="FOTO DEL PARTIDO" color="var(--text-muted)" />
                      {p.foto_url && (
                        // Se muestra con la misma caja 16:9 que el home, para
                        // que el admin vea aquí mismo si esta foto necesita
                        // reencuadre en vez de enterarse en la pantalla de todos.
                        // Sin tope de ancho: la foto es lo único de esta
                        // pantalla que gana con el espacio, y estaba capada a
                        // 340 px mientras la lista de nombres se estiraba a
                        // lo ancho completo.
                        <div style={{ marginBottom: 10, borderRadius: 4, overflow: 'hidden', aspectRatio: '16 / 9', background: '#000' }}>
                          <img
                            src={p.foto_url!}
                            alt="Foto del partido"
                            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
                          />
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <label style={{
                        display: 'inline-block', padding: '8px 16px', fontSize: 12, cursor: uploadingFoto ? 'wait' : 'pointer',
                        border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-card)',
                        color: uploadingFoto ? 'var(--text-dim)' : 'var(--text)',
                        fontFamily: 'DM Mono, monospace', letterSpacing: '0.05em',
                      }}>
                        {uploadingFoto ? 'Subiendo...' : p.foto_url ? '📷 Cambiar foto' : '📷 Subir foto'}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          disabled={uploadingFoto}
                          onChange={e => {
                            const f = e.target.files?.[0]
                            e.target.value = ''   // permite reelegir la misma tras cancelar
                            if (f) setPorRecortar({ partidoId: p.id, file: f })
                          }}
                        />
                      </label>
                      {p.foto_url && (
                        <button
                          onClick={() => reencuadrar(p.id, p.foto_url!)}
                          disabled={uploadingFoto}
                          style={{
                            padding: '8px 16px', fontSize: 12,
                            cursor: uploadingFoto ? 'wait' : 'pointer',
                            border: '1px solid var(--border)', borderRadius: 3,
                            background: 'var(--bg-card)',
                            color: uploadingFoto ? 'var(--text-dim)' : 'var(--text)',
                            fontFamily: 'DM Mono, monospace', letterSpacing: '0.05em',
                          }}
                        >
                          ✂️ Reencuadrar
                        </button>
                      )}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
                        Se muestra en el dashboard cuando cierran las evaluaciones.
                      </div>
                    </div>

                    {/* ── Player list ── */}
                    <div>
                      <SectionHeader
                        title={`JUGADORES — ${inscripciones.filter(i => i.estado === 'confirmado').length} confirmados${inscripciones.some(i => i.estado === 'espera') ? ` · ${inscripciones.filter(i => i.estado === 'espera').length} espera` : ''}`}
                        color="var(--text-muted)"
                      />
                      {loadingIns ? (
                        <LoadingSpinner text="Cargando..." padding={0} />
                      ) : inscripciones.length === 0 ? (
                        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>Sin inscritos registrados.</div>
                      ) : (
                        <ListaJugadores inscripciones={inscripciones} equipoDe={equipoDe} />
                      )}

                      {/* Agregar / remover — un solo control, abajo.
                          Cada fila tenía su REMOVER: catorce botones rojos
                          para algo que casi nunca se hace, y fácil de tocar
                          sin querer al desplazar en el celular. */}
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        <ButtonGroup gap={4}>
                          {(['agregar', 'remover'] as const).map(m => (
                            <button
                              key={m}
                              // Volver a tocar el modo activo lo pliega.
                              onClick={() => { setModo(modo === m ? null : m); setAddPlayerId('') }}
                              className="mono"
                              style={{
                                padding: '6px 12px', fontSize: 11, border: '1px solid',
                                borderColor: modo === m ? (m === 'agregar' ? '#16a34a' : '#7f1d1d') : 'var(--border)',
                                background: modo === m ? (m === 'agregar' ? '#0f2d1a' : '#2a0f0f') : 'none',
                                color: modo === m ? (m === 'agregar' ? 'var(--green)' : 'var(--red)') : 'var(--text-dim)',
                                borderRadius: 3, cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase',
                              }}
                            >
                              {m === 'agregar' ? '+ Agregar' : '− Remover'}
                            </button>
                          ))}
                        </ButtonGroup>

                        {modo !== null && (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                          <div style={{ flex: 1, minWidth: 160 }}>
                            <select
                              value={addPlayerId}
                              onChange={e => setAddPlayerId(e.target.value)}
                              style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontSize: 13 }}
                              aria-label={modo === 'agregar' ? 'Jugador a agregar' : 'Jugador a remover'}
                            >
                              <option value="">— Seleccionar —</option>
                              {(modo === 'agregar'
                                ? availablePlayers.map(pl => ({ id: pl.id, username: pl.username }))
                                : inscripciones.map(i => ({ id: i.player_id, username: i.profiles.username }))
                              ).map(pl => (
                                <option key={pl.id} value={pl.id}>{pl.username}</option>
                              ))}
                            </select>
                          </div>

                          {modo === 'agregar' && (
                            <ButtonGroup gap={4}>
                              {(['confirmado', 'espera'] as const).map(e => (
                                <button
                                  key={e}
                                  onClick={() => setAddEstado(e)}
                                  className="mono"
                                  style={{
                                    padding: '7px 10px', fontSize: 11, border: '1px solid',
                                    borderColor: addEstado === e ? (e === 'confirmado' ? '#16a34a' : '#92400e') : 'var(--border)',
                                    background: addEstado === e ? (e === 'confirmado' ? '#0f2d1a' : '#1a1000') : 'none',
                                    color: addEstado === e ? (e === 'confirmado' ? 'var(--green)' : 'var(--amber)') : 'var(--text-muted)',
                                    borderRadius: 3, cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase',
                                  }}
                                >
                                  {e}
                                </button>
                              ))}
                            </ButtonGroup>
                          )}

                          <button
                            onClick={() => {
                              if (modo === 'agregar') { handleAgregar(p.id); return }
                              const ins = inscripciones.find(i => i.player_id === addPlayerId)
                              if (ins) handleRemover(ins, p.id)
                            }}
                            disabled={!addPlayerId || savingAdd || removingId !== null}
                            className="btn btn-ghost"
                            style={{
                              fontSize: 12, padding: '8px 14px',
                              color: modo === 'agregar' ? 'var(--green)' : 'var(--red)',
                              borderColor: modo === 'agregar' ? '#16a34a' : '#7f1d1d',
                            }}
                          >
                            {savingAdd || removingId ? '...' : modo === 'agregar' ? '+ Agregar' : '− Remover'}
                          </button>
                        </div>
                        )}
                      </div>
                    </div>

                    {/* ── Confirm match happened ── */}
                    {p.jugado !== true && (
                      <div>
                        <SectionHeader title="CONFIRMAR PARTIDO" color="var(--text-muted)" />
                        <button
                          onClick={() => handleConfirmar(p.id)}
                          disabled={savingConfirmar}
                          className="btn btn-primary"
                          style={{ padding: '9px 20px', fontSize: 13 }}
                        >
                          {savingConfirmar ? '...' : '✓ Marcar como jugado'}
                        </button>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                          Abre las votaciones y avisa a los confirmados.
                        </div>
                      </div>
                    )}

                    {/* ── Score entry ──
                        Con el marcador ya guardado, el formulario completo
                        —dos campos grandes y un botón verde— pedía clic para
                        algo que ya está hecho. Se muestra el dato y un enlace
                        gris de "editar"; el formulario aparece solo si se
                        toca. Sin resultado, el formulario sale directo: ahí
                        sí es la acción que toca. */}
                    <div>
                      {score && editandoResultado !== p.id ? (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                            RESULTADO
                          </div>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            {esMinitorneo
                              ? `B${p.puntos_blanco} · N${p.puntos_negro} · M${p.puntos_morado}`
                              : `🤍 ${p.goles_a} – ${p.goles_b} 🖤`}
                          </div>
                          <button
                            onClick={() => { prefillResultado(p); setEditandoResultado(p.id) }}
                            className="mono"
                            style={{
                              fontSize: 10, color: 'var(--text-dim)', background: 'none',
                              border: 'none', cursor: 'pointer', textDecoration: 'underline',
                              padding: 0, letterSpacing: '0.06em',
                            }}
                          >
                            editar
                          </button>
                        </div>
                      ) : (
                      <>
                      <SectionHeader title={score ? 'EDITAR RESULTADO' : 'REGISTRAR RESULTADO'} color="var(--text-muted)" />
                      {esMinitorneo ? (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                          {([
                            { label: '⬜ Blancos', val: ptsBlancos, set: setPtsBlancos },
                            { label: '⬛ Negros', val: ptsNegros, set: setPtsNegros },
                            { label: '🟣 Morados', val: ptsMorados, set: setPtsMorados },
                          ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                            <div key={label}>
                              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
                              <input
                                type="number" min="0" max="99" value={val}
                                onChange={e => set(e.target.value)}
                                style={{ width: '4rem', padding: '8px 10px', textAlign: 'center', fontSize: 18, fontWeight: 700 }}
                              />
                            </div>
                          ))}
                          <button
                            onClick={() => handleResultado(p)}
                            disabled={savingResultado}
                            className="btn btn-primary"
                            style={{ padding: '9px 18px' }}
                          >
                            {savingResultado ? '...' : 'Guardar'}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>🤍 Blancos</div>
                            <input
                              type="number" min="0" max="99" value={golesA}
                              onChange={e => setGolesA(e.target.value)}
                              style={{ width: '4rem', padding: '8px 10px', textAlign: 'center', fontSize: 22, fontWeight: 700 }}
                            />
                          </div>
                          <div className="mono" style={{ fontSize: 20, color: 'var(--text-dim)', paddingBottom: 8 }}>–</div>
                          <div>
                            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>🖤 Negros</div>
                            <input
                              type="number" min="0" max="99" value={golesB}
                              onChange={e => setGolesB(e.target.value)}
                              style={{ width: '4rem', padding: '8px 10px', textAlign: 'center', fontSize: 22, fontWeight: 700 }}
                            />
                          </div>
                          <button
                            onClick={() => handleResultado(p)}
                            disabled={savingResultado}
                            className="btn btn-primary"
                            style={{ padding: '9px 18px' }}
                          >
                            {savingResultado ? '...' : 'Guardar'}
                          </button>
                        </div>
                      )}
                      </>
                      )}
                    </div>


                    {/* ── Evaluaciones ── */}
                    <div>
                      <SectionHeader title="EVALUACIONES" color="var(--text-muted)" />
                      {p.evaluaciones_abiertas ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div className="mono" style={{ fontSize: 12, color: '#a78bfa' }}>📊 Votación abierta — jugadores pueden evaluar.</div>
                          <ProgresoVotacion progreso={progreso[p.id]} />
                          <button
                            onClick={() => handleCerrarVotacion(p.id)}
                            disabled={savingCerrar}
                            className="btn btn-primary"
                            style={{ padding: '9px 20px', fontSize: 13, alignSelf: 'flex-start' }}
                          >
                            {savingCerrar ? '...' : '🏅 Cerrar votación y asignar badges'}
                          </button>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                            Cierra la votación, talla votos y asigna badges a los ganadores por categoría.
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <ProgresoVotacion progreso={progreso[p.id]} cerrada />
                          <button
                            onClick={() => handleAbrirEval(p.id)}
                            disabled={savingEval}
                            className="btn btn-ghost"
                            style={{ fontSize: 12, padding: '8px 16px', color: '#a78bfa', borderColor: '#7c3aed', alignSelf: 'flex-start' }}
                          >
                            {savingEval ? '...' : '📊 Abrir evaluaciones ahora'}
                          </button>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                            Abre votación y notifica por push a jugadores confirmados.
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {porRecortar && (
        <RecorteFotoModal
          archivo={porRecortar.file}
          onCancelar={() => setPorRecortar(null)}
          onListo={f => {
            const { partidoId } = porRecortar
            setPorRecortar(null)
            handleFotoUpload(partidoId, f)
          }}
        />
      )}
    </div>
  )
}

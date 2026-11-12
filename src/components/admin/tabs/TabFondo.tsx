'use client'

import { useCallback, useEffect, useState } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SectionHeader } from '@/components/SectionHeader'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { formatoPesos, type Movimiento, type SaldoFondo, type ResumenRanking } from '@/lib/fondo'
import { fechaColombia } from '@/lib/promoHora'
import type { Player } from '@/types/admin'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "4 ago 2026" — a mano, sin toLocaleDateString (ver skill ui-movil). */
function fechaCorta(fecha: string, conAnio = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m) return fecha
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}${conAnio ? ` ${m[1]}` : ''}`
}

const MEDALLA: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

interface PorPartido {
  partido_id: string
  fecha: string
  dia_semana: string
  mov: Movimiento | null
}

type Datos = SaldoFondo & {
  aporte_default: number
  movimientos: Movimiento[]
  por_partido: PorPartido[]
  sin_registrar: number
  reparto: ResumenRanking
}

type Vista = 'saldo' | 'partidos' | 'gastos' | 'ranking'

const VISTAS: { id: Vista; label: string }[] = [
  { id: 'saldo', label: 'saldo' },
  { id: 'partidos', label: 'por partido' },
  { id: 'gastos', label: 'gastos' },
  { id: 'ranking', label: 'ranking' },
]

/** Solo dígitos: el campo es `inputMode="numeric"`, no `type="number"`. */
const soloDigitos = (s: string) => s.replace(/[^\d]/g, '')

const CHIP: Record<string, { texto: string; color: string }> = {
  sin_recoger: { texto: 'no se recogió', color: 'var(--text-dim)' },
  pendiente: { texto: 'pendiente', color: 'var(--amber)' },
}

/**
 * Fondo MBA: el saldo real del club.
 *
 * Esto mostraba una cuenta teórica (1.000 por persona y por partido, derivada de
 * las inscripciones) sin forma de registrar nada. El número era lo recaudado
 * bruto desde el primer partido, así que no bajaba nunca — y el club lleva la
 * plata de verdad en un mensaje de WhatsApp, con gastos que salían de la cuenta
 * sin aparecer en ninguna parte.
 *
 * Ahora la fuente es `fondo_movimientos` y el número grande es el SALDO.
 */
export function TabFondo({ players, onFlash }: { players: Player[]; onFlash: (m: string) => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState<Vista>('saldo')
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const [verExplicacion, setVerExplicacion] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/admin?accion=fondo')
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) setError(d.error ?? 'No se pudo cargar el fondo')
      else { setDatos(d); setError('') }
    } catch {
      setError('No se pudo cargar el fondo')
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  /**
   * POST propio en vez del `accionAdmin` de la página: ese recarga los datos del
   * panel, que no incluyen el fondo, así que la pantalla se quedaría con el
   * número viejo después de guardar.
   */
  const post = useCallback(async (accion: string, extra: Record<string, unknown>) => {
    setGuardando(true)
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, ...extra }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) { onFlash(`Error: ${d.error ?? 'no se pudo guardar'}`); return false }
      onFlash(d.mensaje ?? 'Hecho.')
      await cargar()
      return true
    } catch {
      onFlash('Error: no se pudo guardar')
      return false
    } finally {
      setGuardando(false)
    }
  }, [cargar, onFlash])

  if (error) return <div className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>{error}</div>
  if (!datos) return <LoadingSpinner text="CARGANDO..." />

  const nombre = (id: string | null) => players.find(p => p.id === id)?.username ?? null

  return (
    <div className="fade-in" style={{ maxWidth: 720 }}>
      {/* ── El saldo ── */}
      <div style={{
        padding: '18px 18px 16px', marginBottom: 18, borderRadius: 6,
        background: 'var(--bg-card)', border: '1px solid var(--primary-deep)',
      }}>
        <div className="mono" style={{ fontSize: 12, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
          SALDO DEL FONDO
        </div>
        <div className="display" style={{
          fontSize: 44, lineHeight: 1.1, marginTop: 6,
          color: datos.saldo < 0 ? 'var(--red)' : 'var(--primary)',
        }}>
          {formatoPesos(datos.saldo)}
        </div>

        {/* Las tres partidas suman el saldo. `gastado` ya viene negativo. */}
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Recaudado</span><span>{formatoPesos(datos.recaudado)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Gastado</span>
            <span style={{ color: datos.gastado ? 'var(--red)' : undefined }}>{formatoPesos(datos.gastado)}</span>
          </div>
          {datos.ajustes !== 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Ajustes</span><span>{formatoPesos(datos.ajustes)}</span>
            </div>
          )}
        </div>

        <button
          onClick={() => setVerExplicacion(v => !v)}
          className="mono"
          style={{
            marginTop: 12, padding: 0, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: 'var(--text-dim)', textAlign: 'left',
          }}
        >
          {verExplicacion ? '▲' : '▼'} ¿De dónde sale?
        </button>
        {verExplicacion && (
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, marginTop: 8 }}>
            Cada partido se recoge para pagar la cancha y sobra algo (normalmente{' '}
            <strong style={{ color: 'var(--text-muted)' }}>{formatoPesos(datos.aporte_default)}</strong>)
            que va al fondo. Acá se registra lo que de verdad entró en cada partido, no un promedio.
            <br /><br />
            El saldo es <strong style={{ color: 'var(--text-muted)' }}>recaudado − gastos ± ajustes</strong>.
            Los ajustes son para cuadrar contra el saldo real de la cuenta cuando no coincide.
            <br /><br />
            El ranking reparte el monto de cada partido entre los que estuvieron, así que un partido
            donde no se recogió nada no le suma a nadie.
          </div>
        )}
      </div>

      {/* ── Avisos accionables ── */}
      {(datos.sin_registrar > 0 || datos.pendientes > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
          {datos.sin_registrar > 0 && (
            <button
              onClick={() => setVista('partidos')}
              className="mono"
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 4, cursor: 'pointer',
                fontSize: 12, lineHeight: 1.5, color: 'var(--amber)',
                background: 'var(--bg-card)', border: '1px solid var(--amber)',
              }}
            >
              ⚠ {datos.sin_registrar} partido{datos.sin_registrar !== 1 ? 's' : ''} jugado
              {datos.sin_registrar !== 1 ? 's' : ''} sin registrar en el fondo →
            </button>
          )}
          {datos.pendientes > 0 && (
            <button
              onClick={() => setVista('partidos')}
              className="mono"
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 4, cursor: 'pointer',
                fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
                background: 'var(--bg-card)', border: '1px dashed var(--border)',
              }}
            >
              ⏳ {datos.pendientes} por cobrar: alguien tiene la plata y no la ha entregado →
            </button>
          )}
        </div>
      )}

      {/* ── Vistas ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {VISTAS.map(v => (
          <button
            key={v.id}
            onClick={() => { setVista(v.id); setAbiertoId(null) }}
            className="mono"
            style={{
              padding: '7px 11px', borderRadius: 3, cursor: 'pointer', fontSize: 12,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              background: vista === v.id ? 'var(--primary)' : 'var(--bg-card)',
              color: vista === v.id ? 'var(--on-primary)' : 'var(--text-muted)',
              border: `1px solid ${vista === v.id ? 'var(--primary)' : 'var(--border)'}`,
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {vista === 'saldo' && (
        <MovimientosLista
          movs={datos.movimientos}
          nombre={nombre}
          titulo="Todo lo que ha pasado"
          onBorrar={id => post('fondo_borrar', { id })}
          guardando={guardando}
        />
      )}

      {vista === 'partidos' && (
        <PorPartidoLista
          filas={datos.por_partido}
          players={players}
          aporteDefault={datos.aporte_default}
          abiertoId={abiertoId}
          setAbiertoId={setAbiertoId}
          guardando={guardando}
          onGuardar={(partido_id, extra) => post('fondo_partido', { partido_id, ...extra })}
          onBorrar={id => post('fondo_borrar', { id })}
        />
      )}

      {vista === 'gastos' && (
        <Gastos
          movs={datos.movimientos.filter(m => m.tipo === 'gasto' || m.tipo === 'ajuste')}
          players={players}
          nombre={nombre}
          guardando={guardando}
          onGasto={extra => post('fondo_gasto', extra)}
          onAjuste={extra => post('fondo_ajuste', extra)}
          onBorrar={id => post('fondo_borrar', { id })}
        />
      )}

      {vista === 'ranking' && <Ranking reparto={datos.reparto} abiertoId={abiertoId} setAbiertoId={setAbiertoId} />}
    </div>
  )
}

// ── Lista de movimientos ─────────────────────────────────────────────────────

function MovimientosLista({ movs, nombre, titulo, onBorrar, guardando }: {
  movs: Movimiento[]
  nombre: (id: string | null) => string | null
  titulo: string
  onBorrar: (id: string) => void
  guardando: boolean
}) {
  return (
    <>
      <SectionHeader title={titulo} count={movs.length} color="var(--text-muted)" />
      {movs.length === 0 ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>Todavía no hay movimientos.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {movs.map(m => (
            <MovimientoFila key={m.id} m={m} nombre={nombre} onBorrar={onBorrar} guardando={guardando} />
          ))}
        </div>
      )}
    </>
  )
}

function MovimientoFila({ m, nombre, onBorrar, guardando }: {
  m: Movimiento
  nombre: (id: string | null) => string | null
  onBorrar: (id: string) => void
  guardando: boolean
}) {
  const chip = CHIP[m.tipo]
  const quien = m.encargado?.username ?? nombre(m.encargado_id)
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {fechaCorta(m.fecha, true)}
          {m.tipo === 'ajuste' && <span style={{ color: 'var(--text-dim)' }}> · ajuste</span>}
        </div>
        {(m.concepto || quien) && (
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5 }}>
            {m.concepto}
            {m.concepto && quien ? ' · ' : ''}
            {quien && `👤 ${quien}`}
          </div>
        )}
      </div>
      {/* `nowrap` + `flex-start` arriba: sin eso, un concepto de dos líneas se
          intercala con el monto y las dos frases se leen como una sola. */}
      <span className="mono" style={{
        fontSize: 13, flexShrink: 0, whiteSpace: 'nowrap', paddingTop: 1,
        color: chip ? chip.color : m.monto < 0 ? 'var(--red)' : 'var(--primary)',
      }}>
        {chip ? chip.texto : formatoPesos(m.monto)}
      </span>
      <button
        onClick={() => { if (window.confirm('¿Borrar este movimiento del fondo?')) onBorrar(m.id) }}
        disabled={guardando}
        title="Borrar"
        className="mono"
        style={{
          flexShrink: 0, padding: '4px 7px', borderRadius: 3, cursor: 'pointer', fontSize: 12,
          background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)',
        }}
      >
        ✕
      </button>
    </div>
  )
}

// ── Por partido ──────────────────────────────────────────────────────────────

const DIA_CORTO = (d: string) => (d || '').slice(0, 3).toLowerCase()

function PorPartidoLista({ filas, players, aporteDefault, abiertoId, setAbiertoId, guardando, onGuardar, onBorrar }: {
  filas: PorPartido[]
  players: Player[]
  aporteDefault: number
  abiertoId: string | null
  setAbiertoId: (id: string | null) => void
  guardando: boolean
  onGuardar: (partidoId: string, extra: Record<string, unknown>) => Promise<boolean>
  onBorrar: (id: string) => void
}) {
  const faltan = filas.filter(f => !f.mov).length
  return (
    <>
      <SectionHeader title="Cada partido jugado" count={filas.length} color="var(--text-muted)" />
      {faltan > 0 && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10 }}>
          Los {faltan} en ámbar no tienen nada registrado. Toca uno para poner lo que se recogió, o
          para dejar constancia de que ese día no se recogió nada.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filas.map(f => {
          const abierto = abiertoId === f.partido_id
          const chip = f.mov ? CHIP[f.mov.tipo] : null
          const sinRegistrar = !f.mov
          return (
            <div key={f.partido_id} style={{
              background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden',
              border: `1px solid ${abierto ? 'var(--primary)' : sinRegistrar ? 'var(--amber)' : 'var(--border)'}`,
            }}>
              <button
                onClick={() => setAbiertoId(abierto ? null : f.partido_id)}
                aria-expanded={abierto}
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>
                    {fechaCorta(f.fecha, true)}{' '}
                    <span className="mono" style={{ fontSize: 12, color: 'var(--primary)' }}>{DIA_CORTO(f.dia_semana)}</span>
                  </div>
                  {f.mov?.encargado && (
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>
                      👤 {f.mov.encargado.username}
                    </div>
                  )}
                  {f.mov?.concepto && !f.mov.encargado && (
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>
                      {f.mov.concepto}
                    </div>
                  )}
                </div>
                <span className="mono" style={{
                  fontSize: 13, flexShrink: 0, whiteSpace: 'nowrap', paddingTop: 2,
                  color: sinRegistrar ? 'var(--amber)' : chip ? chip.color : 'var(--primary)',
                }}>
                  {sinRegistrar ? 'sin registrar' : chip ? chip.texto : formatoPesos(f.mov!.monto)}
                </span>
              </button>

              {abierto && (
                <FormPartido
                  fila={f}
                  players={players}
                  aporteDefault={aporteDefault}
                  guardando={guardando}
                  onGuardar={extra => onGuardar(f.partido_id, extra)}
                  onBorrar={onBorrar}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

const TIPOS: { id: string; label: string }[] = [
  { id: 'aporte', label: 'se recogió' },
  { id: 'sin_recoger', label: 'no se recogió' },
  { id: 'pendiente', label: 'pendiente' },
]

function FormPartido({ fila, players, aporteDefault, guardando, onGuardar, onBorrar }: {
  fila: PorPartido
  players: Player[]
  aporteDefault: number
  guardando: boolean
  onGuardar: (extra: Record<string, unknown>) => Promise<boolean>
  onBorrar: (id: string) => void
}) {
  const [tipo, setTipo] = useState<string>(fila.mov?.tipo ?? 'aporte')
  const [monto, setMonto] = useState(String(fila.mov && fila.mov.tipo === 'aporte' ? fila.mov.monto : aporteDefault))
  const [encargado, setEncargado] = useState(fila.mov?.encargado_id ?? '')
  const [concepto, setConcepto] = useState(fila.mov?.concepto ?? '')

  const guardar = async () => {
    await onGuardar({
      tipo,
      monto: tipo === 'aporte' ? Number(monto) : 0,
      encargado_id: encargado || null,
      concepto: concepto.trim() || null,
    })
  }

  return (
    <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TIPOS.map(t => (
          <button
            key={t.id}
            onClick={() => setTipo(t.id)}
            className="mono"
            style={{
              padding: '7px 10px', borderRadius: 3, cursor: 'pointer', fontSize: 12,
              background: tipo === t.id ? 'var(--bg-elevated)' : 'none',
              color: tipo === t.id ? 'var(--text)' : 'var(--text-dim)',
              border: `1px solid ${tipo === t.id ? 'var(--primary)' : 'var(--border)'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tipo === 'aporte' && (
        <Campo label="CUÁNTO ENTRÓ">
          <input
            type="text"
            inputMode="numeric"
            value={monto}
            onChange={e => setMonto(soloDigitos(e.target.value))}
            placeholder={String(aporteDefault)}
          />
        </Campo>
      )}

      <Campo label="QUIÉN RECOGIÓ">
        <SelectJugador players={players} value={encargado} onChange={setEncargado} />
      </Campo>

      <Campo label={tipo === 'aporte' ? 'NOTA (OPCIONAL)' : 'MOTIVO'}>
        <input
          type="text"
          value={concepto}
          onChange={e => setConcepto(e.target.value.slice(0, 120))}
          placeholder={tipo === 'sin_recoger' ? 'faltó gente por lluvia' : 'opcional'}
        />
      </Campo>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={guardar} disabled={guardando} className="btn btn-primary" style={{ flex: 1, padding: '12px' }}>
          {guardando ? 'GUARDANDO...' : 'GUARDAR'}
        </button>
        {fila.mov && (
          <button
            onClick={() => { if (window.confirm('¿Borrar el registro del fondo de este partido?')) onBorrar(fila.mov!.id) }}
            disabled={guardando}
            className="btn btn-ghost"
            style={{ padding: '12px 14px' }}
          >
            BORRAR
          </button>
        )}
      </div>
    </div>
  )
}

// ── Gastos y ajustes ─────────────────────────────────────────────────────────

function Gastos({ movs, players, nombre, guardando, onGasto, onAjuste, onBorrar }: {
  movs: Movimiento[]
  players: Player[]
  nombre: (id: string | null) => string | null
  guardando: boolean
  onGasto: (extra: Record<string, unknown>) => Promise<boolean>
  onAjuste: (extra: Record<string, unknown>) => Promise<boolean>
  onBorrar: (id: string) => void
}) {
  // Plegado: registrar un gasto es acción ocasional y no tiene por qué ocupar
  // sitio cada vez que se abre la pestaña.
  const [modo, setModo] = useState<'' | 'gasto' | 'ajuste'>('')
  const [fecha, setFecha] = useState(() => fechaColombia())
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('')
  const [encargado, setEncargado] = useState('')
  const [negativo, setNegativo] = useState(false)

  const limpiar = () => { setMonto(''); setConcepto(''); setEncargado(''); setNegativo(false); setModo('') }

  const enviar = async () => {
    const n = Number(monto)
    if (!n) return
    const ok = modo === 'gasto'
      ? await onGasto({ fecha, monto: n, concepto: concepto.trim(), encargado_id: encargado || null })
      : await onAjuste({ fecha, monto: negativo ? -n : n, concepto: concepto.trim() })
    if (ok) limpiar()
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setModo(m => (m === 'gasto' ? '' : 'gasto'))}
          className="btn btn-ghost"
          style={{ flex: 1, padding: '12px', color: modo === 'gasto' ? 'var(--text)' : undefined }}
        >
          ➕ GASTO
        </button>
        <button
          onClick={() => setModo(m => (m === 'ajuste' ? '' : 'ajuste'))}
          className="btn btn-ghost"
          style={{ flex: 1, padding: '12px', color: modo === 'ajuste' ? 'var(--text)' : undefined }}
        >
          ⚖ AJUSTE
        </button>
      </div>

      {modo && (
        <div style={{
          padding: '14px 14px 16px', marginBottom: 18, borderRadius: 5,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {modo === 'gasto'
              ? 'Plata que salió del fondo. Se resta del saldo y no toca lo recaudado.'
              : 'Para cuadrar contra el saldo real de la cuenta cuando no coincide con lo que dice la app.'}
          </div>

          <Campo label="FECHA">
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </Campo>

          <Campo label={modo === 'gasto' ? 'CUÁNTO SALIÓ' : 'DIFERENCIA'}>
            <input
              type="text"
              inputMode="numeric"
              value={monto}
              onChange={e => setMonto(soloDigitos(e.target.value))}
              placeholder="0"
            />
          </Campo>

          {modo === 'ajuste' && (
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ v: false, l: 'había MÁS' }, { v: true, l: 'había MENOS' }].map(o => (
                <button
                  key={o.l}
                  onClick={() => setNegativo(o.v)}
                  className="mono"
                  style={{
                    flex: 1, padding: '9px', borderRadius: 3, cursor: 'pointer', fontSize: 12,
                    background: negativo === o.v ? 'var(--bg-elevated)' : 'none',
                    color: negativo === o.v ? 'var(--text)' : 'var(--text-dim)',
                    border: `1px solid ${negativo === o.v ? 'var(--primary)' : 'var(--border)'}`,
                  }}
                >
                  {o.l}
                </button>
              ))}
            </div>
          )}

          <Campo label="EN QUÉ">
            <input
              type="text"
              value={concepto}
              onChange={e => setConcepto(e.target.value.slice(0, 120))}
              placeholder={modo === 'gasto' ? 'balones, petos, arbitraje...' : 'por qué no cuadraba'}
            />
          </Campo>

          {modo === 'gasto' && (
            <Campo label="QUIÉN PAGÓ (OPCIONAL)">
              <SelectJugador players={players} value={encargado} onChange={setEncargado} />
            </Campo>
          )}

          <button
            onClick={enviar}
            disabled={guardando || !Number(monto) || !concepto.trim()}
            className="btn btn-primary"
            style={{ padding: '13px', marginTop: 2 }}
          >
            {guardando ? 'GUARDANDO...' : modo === 'gasto' ? 'REGISTRAR GASTO' : 'REGISTRAR AJUSTE'}
          </button>
        </div>
      )}

      <MovimientosLista
        movs={movs}
        nombre={nombre}
        titulo="Gastos y ajustes"
        onBorrar={onBorrar}
        guardando={guardando}
      />
    </>
  )
}

// ── Ranking ──────────────────────────────────────────────────────────────────

function Ranking({ reparto, abiertoId, setAbiertoId }: {
  reparto: ResumenRanking
  abiertoId: string | null
  setAbiertoId: (id: string | null) => void
}) {
  const max = reparto.ranking[0]?.total ?? 0
  return (
    <>
      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
        El monto de cada partido, repartido entre los que estuvieron.{' '}
        {reparto.partidos} partido{reparto.partidos !== 1 ? 's' : ''} con plata registrada
        {reparto.desde && <> desde el {fechaCorta(reparto.desde, true)}</>}.
      </div>

      <SectionHeader title="Quién ha aportado" count={reparto.ranking.length} color="var(--text-muted)" />

      {reparto.ranking.length === 0 ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Todavía no hay partidos con plata registrada.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {reparto.ranking.map(a => {
            const abierto = abiertoId === a.player_id
            const podio = a.puesto <= 3
            return (
              <div key={a.player_id} style={{
                background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden',
                border: `1px solid ${abierto ? 'var(--primary)' : 'var(--border)'}`,
              }}>
                <button
                  onClick={() => setAbiertoId(abierto ? null : a.player_id)}
                  aria-expanded={abierto}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px 8px', background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                  }}
                >
                  <span className="mono" style={{
                    width: 26, flexShrink: 0, textAlign: 'center',
                    fontSize: podio ? 20 : 12, color: 'var(--text-dim)',
                  }}>
                    {MEDALLA[a.puesto] ?? a.puesto}
                  </span>
                  <PlayerAvatar url={a.avatar_url} username={a.username} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.username}
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                      {a.partidos} partido{a.partidos !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 14, color: podio ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }}>
                    {formatoPesos(a.total)}
                  </span>
                </button>

                {/* Barra proporcional al primero. */}
                <div style={{ height: 3, margin: '0 12px 10px 48px', background: 'var(--bg-elevated)', borderRadius: 2 }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: `${max ? Math.max(2, (a.total / max) * 100) : 0}%`,
                    background: podio ? 'var(--primary)' : '#2f5d3f',
                  }} />
                </div>

                {abierto && (
                  <div style={{ padding: '0 12px 12px 48px' }}>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Desde el {fechaCorta(a.primera, true)} · último el {fechaCorta(a.ultima, true)}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {a.fechas.map(f => (
                        <span key={f} className="mono" style={{
                          fontSize: 12, padding: '3px 7px', borderRadius: 2,
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                        }}>
                          {fechaCorta(f)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {reparto.invitados.personas > 0 && (
        <div className="mono" style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 4, fontSize: 12,
          border: '1px dashed var(--border)', color: 'var(--text-muted)',
          display: 'flex', justifyContent: 'space-between', gap: 10,
        }}>
          <span>Invitados · {reparto.invitados.personas} aporte{reparto.invitados.personas !== 1 ? 's' : ''}</span>
          <span>{formatoPesos(reparto.invitados.total)}</span>
        </div>
      )}

      {/* Plata que entró y no es de nadie en el ranking: aportes sin inscritos
          registrados. Se muestra aparte en vez de diluirla entre los demás. */}
      {reparto.sinRepartir.partidos > 0 && (
        <div className="mono" style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 4, fontSize: 12,
          border: '1px dashed var(--border)', color: 'var(--text-dim)', lineHeight: 1.6,
        }}>
          {formatoPesos(reparto.sinRepartir.total)} de {reparto.sinRepartir.partidos} aporte
          {reparto.sinRepartir.partidos !== 1 ? 's' : ''} no se reparte: son partidos sin inscritos
          registrados en la app. La plata está en el saldo.
        </div>
      )}
    </>
  )
}

// ── Piezas de formulario ─────────────────────────────────────────────────────

/** Los `input` no llevan fontSize inline: la regla base de globals.css los deja
 *  en 16 px, y menos de 16 hace que Safari haga zoom al enfocar (skill ui-movil). */
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mono" style={{
        fontSize: 12, letterSpacing: '0.1em', color: 'var(--text-muted)',
        display: 'block', marginBottom: 5,
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function SelectJugador({ players, value, onChange }: {
  players: Player[]
  value: string
  onChange: (v: string) => void
}) {
  const lista = [...players].sort((a, b) => a.username.localeCompare(b.username))
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%' }}>
      <option value="">— nadie —</option>
      {lista.map(p => <option key={p.id} value={p.id}>{p.username}</option>)}
    </select>
  )
}

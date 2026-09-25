'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { formatRating } from '@/lib/tier'
import {
  calcularPuntaje, clampRating, round3, formatDelta, explicarMotivo,
  CAP_NORMAL, CAP_MINI, STEP, BASE_RATING,
  type Resultado, type SenalesPartido,
} from '@/lib/puntaje'

/**
 * Reglas del puntaje + simulador.
 *
 * Nació de un reclamo directo: nadie sabía por qué su número subía o bajaba.
 * Las reglas estaban escritas, sí — en un comentario de lib/rating.ts, que no
 * es un lugar donde alguien del club vaya a leerlas.
 *
 * Lo importante de esta pantalla no es el texto, es que la cuenta la hace
 * `calcularPuntaje`, la MISMA función que corre en el servidor al cerrar las
 * votaciones. Un simulador que reimplemente la fórmula se desincroniza a la
 * primera y queda mintiendo con cara de autoridad.
 */

interface Badge { id: string; emoji: string; nombre: string; signo: 'positivo' | 'negativo' | 'neutral' }

interface Datos {
  reglas: { step: number; capNormal: number; capMini: number; thumbsPaso: number; faltasGap: number }
  castigo: { activo: boolean; desde: string | null }
  quorum: { minVotos: number; minVotantes: number; minGanador: number }
  badges: Badge[]
  mi_puntaje: number
}

const VERDE = 'var(--green)'
const ROJO = '#f87171'
// Alto de la barra de arriba, que también está pegada: el resultado se pega
// justo debajo y no encima de ella.
const ALTO_NAV = 54

const colorDelta = (n: number) => (n > 0 ? VERDE : n < 0 ? ROJO : 'var(--text-dim)')

function Chip({ activo, onClick, color, children, flex }: {
  activo: boolean; onClick: () => void; color?: string; children: React.ReactNode; flex?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        padding: '8px 14px', fontSize: 12, cursor: 'pointer', borderRadius: 3,
        letterSpacing: '0.06em', whiteSpace: 'nowrap', flex: flex ? 1 : undefined,
        border: `1px solid ${activo ? (color ?? VERDE) : 'var(--border)'}`,
        background: activo ? 'var(--bg-elevated)' : 'transparent',
        color: activo ? (color ?? VERDE) : 'var(--text-dim)',
      }}
    >
      {children}
    </button>
  )
}

/** −/+ para contar pulgares o faltas sin teclado: esto se usa en el celular. */
function Contador({ valor, set, max, label }: {
  valor: number; set: (n: number) => void; max: number; label: React.ReactNode
}) {
  const btn: React.CSSProperties = {
    width: 34, height: 34, borderRadius: 3, cursor: 'pointer', fontSize: 16,
    border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>{label}</span>
      <button style={btn} onClick={() => set(Math.max(0, valor - 1))} aria-label="menos">−</button>
      <span className="display" style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{valor}</span>
      <button style={btn} onClick={() => set(Math.min(max, valor + 1))} aria-label="más">+</button>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 10 }}>
        {titulo}
      </div>
      {children}
    </div>
  )
}

export default function PuntajePage() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')

  // ── Estado del simulador ──
  const [esMini, setEsMini] = useState(false)
  const [jugo, setJugo] = useState(true)
  const [resultado, setResultado] = useState<Resultado>('ganó')
  const [ganados, setGanados] = useState<Set<string>>(new Set())
  const [likes, setLikes] = useState(0)
  const [dislikes, setDislikes] = useState(0)
  const [voto, setVoto] = useState(true)
  const [racha, setRacha] = useState(1)

  useEffect(() => {
    fetch('/api/puntaje')
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (r.status === 401) { window.location.href = '/login'; return }
        if (!r.ok) { setError(d.error ?? 'No se pudieron cargar las reglas'); return }
        setDatos(d as Datos)
      })
      .catch(() => setError('No se pudieron cargar las reglas'))
  }, [])

  const toggleBadge = (id: string) => {
    setGanados(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  const calculo = useMemo(() => {
    if (!datos) return null
    const positivos = datos.badges.filter(b => b.signo === 'positivo').map(b => b.id)
    const senales: SenalesPartido = {
      jugo,
      resultado: jugo ? resultado : null,
      recoPos: [...ganados].filter(id => positivos.includes(id)).length,
      recoNeg: [...ganados].filter(id => !positivos.includes(id)).length,
      likes,
      dislikes,
      voto,
      ausente: false,
      rachaFaltas: racha,
    }
    return calcularPuntaje(senales, {
      thumbsPaso: datos.reglas.thumbsPaso,
      faltasGap: datos.reglas.faltasGap,
      // El castigo solo existe si el club lo tiene prendido con fecha puesta.
      castigaNoVotar: datos.castigo.activo && datos.castigo.desde !== null,
    }, esMini)
  }, [datos, jugo, resultado, ganados, likes, dislikes, voto, racha, esMini])

  if (error) {
    return (
      <div className="container" style={{ paddingTop: 60, textAlign: 'center' }}>
        <div className="mono" style={{ fontSize: 13, color: 'var(--amber)' }}>{error}</div>
        <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-block', marginTop: 20 }}>← Volver</Link>
      </div>
    )
  }
  if (!datos || !calculo) return <div style={{ paddingTop: 60 }}><LoadingSpinner text="CARGANDO..." /></div>

  const { reglas, castigo, badges } = datos
  const positivos = badges.filter(b => b.signo === 'positivo')
  const negativos = badges.filter(b => b.signo === 'negativo')
  const paso = STEP.toFixed(2)
  const antes = datos.mi_puntaje
  const despues = clampRating(round3(antes + calculo.delta))
  const tope = esMini ? CAP_MINI : CAP_NORMAL
  const castigoActivo = castigo.activo && castigo.desde !== null
  return (
    <div style={{ minHeight: '100vh', paddingBottom: 60 }}>
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 30 }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
          <span className="display" style={{ fontSize: 18, letterSpacing: '0.08em' }}>TU PUNTAJE</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 20, maxWidth: 560 }}>

        {/* ── Cómo funciona, en cuatro líneas ── */}
        <div style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 24, lineHeight: 1.7 }}>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Todos arrancan en <strong style={{ color: 'var(--text)' }}>{BASE_RATING.toFixed(2)}</strong> y el número se mueve
            de a poquito: cada señal de un partido vale <strong style={{ color: 'var(--text)' }}>{paso}</strong>.
            Sube y baja entre 1.00 y 5.00.
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
            Se aplica una sola vez, cuando cierran las votaciones del partido. Antes de eso nada se mueve.
          </div>
        </div>

        {/* ── Simulador ──
            El resultado va ARRIBA de los controles y pegado al tope. Suelto
            debajo quedaba fuera de pantalla justo cuando uno toca los chips
            (medido a 390×844: los reconocimientos ocupan cuatro filas y lo
            empujan), y pegado abajo se montaba encima de la tabla de reglas.
            Un `sticky` solo se pega dentro de su padre, así que al terminar el
            simulador se despega solo y la tabla de abajo queda libre. */}
        <div style={{ marginBottom: 32 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 10 }}>
            SIMULA TU PRÓXIMO PARTIDO
          </div>

          <div style={{
            padding: 16, background: 'var(--bg-card)', borderRadius: 6, marginBottom: 14,
            border: `1px solid ${calculo.delta === 0 ? 'var(--border)' : colorDelta(calculo.delta)}`,
            position: 'sticky', top: ALTO_NAV, zIndex: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="display" style={{ fontSize: 40, lineHeight: 1, color: colorDelta(calculo.delta) }}>
                {formatDelta(calculo.delta)}
              </div>
              <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {formatRating(antes)} <span style={{ color: 'var(--text-dim)' }}>→</span>{' '}
                <strong style={{ color: 'var(--text)' }}>{formatRating(despues)}</strong>
              </div>
            </div>

            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {calculo.lineas.map((l, i) => (
                <div key={i} className="mono" style={{ fontSize: 11, display: 'flex', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, color: l.escalones === 0 ? 'var(--text-dim)' : 'var(--text-muted)' }}>
                    {explicarMotivo(l.motivo)}
                  </span>
                  <span style={{ color: colorDelta(l.escalones) }}>
                    {formatDelta(l.escalones * STEP)}
                  </span>
                </div>
              ))}
            </div>

            {calculo.topado && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--amber)', marginTop: 12, lineHeight: 1.6 }}>
                Te daba {formatDelta(calculo.bruto)}, pero el tope de {esMini ? 'un minitorneo' : 'un partido'} es
                ±{tope.toFixed(3)}. Lo que sobra se pierde para este partido, no para siempre.
              </div>
            )}

            {despues !== round3(antes + calculo.delta) && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>
                Recortado al límite de la escala (1.00 – 5.00).
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Chip flex activo={!esMini} onClick={() => setEsMini(false)}>PARTIDO NORMAL</Chip>
              <Chip flex activo={esMini} color="#a78bfa" onClick={() => setEsMini(true)}>🏆 MINITORNEO</Chip>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <Chip flex activo={jugo} onClick={() => setJugo(true)}>JUGUÉ</Chip>
              <Chip flex activo={!jugo} color="var(--amber)" onClick={() => setJugo(false)}>NO ME INSCRIBÍ</Chip>
            </div>

            {jugo ? (
              <>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Chip flex activo={resultado === 'ganó'} onClick={() => setResultado('ganó')}>GANÉ</Chip>
                  <Chip flex activo={resultado === 'empató'} color="var(--amber)" onClick={() => setResultado('empató')}>EMPATÉ</Chip>
                  <Chip flex activo={resultado === 'perdió'} color={ROJO} onClick={() => setResultado('perdió')}>PERDÍ</Chip>
                </div>

                <div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                    Reconocimientos que te ganaste
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {badges.map(b => (
                      <Chip
                        key={b.id}
                        activo={ganados.has(b.id)}
                        color={b.signo === 'positivo' ? VERDE : ROJO}
                        onClick={() => toggleBadge(b.id)}
                      >
                        {b.emoji} {b.nombre}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                    Pulgares que te dieron — cada {reglas.thumbsPaso} valen {paso}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Contador valor={likes} set={setLikes} max={30} label="👍 a favor" />
                    <Contador valor={dislikes} set={setDislikes} max={30} label="👎 en contra" />
                  </div>
                </div>

                {castigoActivo && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>¿Evaluaste?</span>
                    <Chip activo={voto} onClick={() => setVoto(true)}>SÍ</Chip>
                    <Chip activo={!voto} color={ROJO} onClick={() => setVoto(false)}>NO</Chip>
                  </div>
                )}
              </>
            ) : (
              <Contador
                valor={racha} set={setRacha} max={12}
                label={<>Faltas seguidas <span style={{ color: 'var(--text-dim)' }}>(contando esta)</span></>}
              />
            )}
          </div>
        </div>

        {/* ── La tabla de reglas ── */}
        <Seccion titulo="QUÉ MUEVE EL PUNTAJE">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Regla valor={0} texto="Jugar" detalle="Presentarse no suma por sí solo: el número mide cómo juegas, no cuántas veces apareciste." />
            <Regla valor={+STEP} texto="Ganar" detalle="El empate no mueve nada." />
            <Regla valor={-STEP} texto="Perder" />
            <Regla valor={+STEP} texto="Cada reconocimiento bueno"
              detalle={positivos.map(b => `${b.emoji} ${b.nombre}`).join(' · ')} />
            <Regla valor={-STEP} texto="Cada reconocimiento malo"
              detalle={negativos.map(b => `${b.emoji} ${b.nombre}`).join(' · ')} />
            <Regla valor={+STEP} texto={`Cada ${reglas.thumbsPaso} 👍 que te den`}
              detalle={`Sueltos no mueven nada. Con ${reglas.thumbsPaso * 2} son dos escalones. Los 👍 y los 👎 se cuentan por separado, no se restan entre sí.`} />
            <Regla valor={-STEP} texto={`Cada ${reglas.thumbsPaso} 👎 que te den`} />
            {castigoActivo && (
              <Regla valor={-STEP} texto="Jugar y no evaluar a nadie"
                detalle={`Solo si la votación de ese partido se quedó corta (menos de ${datos.quorum.minVotantes} votantes). Si votó suficiente gente los reconocimientos se repartieron igual, y no se le cobra a nadie.`} />
            )}
            <Regla valor={-STEP} texto={`No inscribirse ${reglas.faltasGap} partidos seguidos`}
              detalle={`Las primeras ${reglas.faltasGap - 1} faltas seguidas son gratis, y cualquier partido que juegues vuelve la cuenta a cero. Quien solo puede los martes nunca acumula.`} />
            <Regla valor={0} texto="Quedar en lista de espera"
              detalle="Te inscribiste; que no entraras no es culpa tuya. No baja nada." />
          </div>

          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.7, padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 4, border: '1px solid var(--border)' }}>
            <strong style={{ color: 'var(--amber)' }}>Hay un tope por partido.</strong> Sumes lo que sumes, un partido
            normal no te mueve más de <strong style={{ color: 'var(--text)' }}>±{CAP_NORMAL.toFixed(3)}</strong> y
            un minitorneo más de <strong style={{ color: 'var(--text)' }}>±{CAP_MINI.toFixed(2)}</strong>.
            Nadie pega un salto en una sola fecha.
          </div>
        </Seccion>

        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 24, lineHeight: 1.7, textAlign: 'center' }}>
          Esta cuenta la hace exactamente el mismo código que corre al cerrar las votaciones.
          <br />
          Si acá dice {formatDelta(calculo.delta)}, eso es lo que te va a quedar.
        </div>
      </div>
    </div>
  )
}

function Regla({ valor, texto, detalle }: { valor: number; texto: string; detalle?: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 3, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>{texto}</div>
        {detalle && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.6 }}>{detalle}</div>
        )}
      </div>
      <div className="mono" style={{ fontSize: 13, color: colorDelta(valor), flexShrink: 0 }}>
        {valor === 0 ? '0.00' : formatDelta(valor)}
      </div>
    </div>
  )
}

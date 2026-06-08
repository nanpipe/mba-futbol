'use client'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { CATEGORIAS } from '@/lib/categorias'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { ThumbsRater } from '@/components/ThumbsRater'
import { FormCenterLayout } from '@/components/FormCenterLayout'
import { ErrorAlert } from '@/components/ErrorAlert'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'

interface Compañero {
  id: string
  username: string
  avatar_url: string | null
  posicion: string
}

function ResultadosPanel({ resultados }: { resultados: { categoria: string; emoji: string; nombre: string; ganador: string; votos: number }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {resultados.map(r => (
        <div key={r.categoria} style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '14px 18px', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 6,
        }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>{r.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 2 }}>{r.nombre}</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{r.ganador}</div>
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>
            {r.votos} voto{r.votos !== 1 ? 's' : ''}
          </div>
        </div>
      ))}
      <Link href="/" className="btn btn-ghost" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>← Volver al inicio</Link>
    </div>
  )
}

function PlayerChip({
  p,
  selected,
  onSelect,
}: {
  p: Compañero
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 20,
        background: selected ? 'var(--green)' : 'var(--bg-card)',
        border: `1px solid ${selected ? 'var(--green)' : 'var(--border)'}`,
        color: selected ? '#000' : 'var(--text)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: selected ? 600 : 400,
        transition: 'all 0.15s',
      }}
    >
      <PlayerAvatar url={p.avatar_url} username={p.username} size={20} borderColor="rgba(255,255,255,0.1)" />
      {p.username}
    </button>
  )
}

export default function EvaluarPage({ params }: { params: Promise<{ partido_id: string }> }) {
  const { partido_id } = use(params)
  const supabase = createClient()

  interface Resultado { categoria: string; emoji: string; nombre: string; ganador: string; votos: number }

  const [estado, setEstado] = useState<'loading' | 'closed' | 'not-participant' | 'already' | 'open' | 'done'>('loading')
  const [compañeros, setCompañeros] = useState<Compañero[]>([])
  const [votos, setVotos] = useState<Record<string, string>>({})  // categoriaId → playerId
  const [thumbs, setThumbs] = useState<Record<string, 1 | -1>>({})  // playerId → ±1
  const [partido, setPartido] = useState<{ fecha: string; dia_semana: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [votosFinales, setVotosFinales] = useState(0)
  const [resultados, setResultados] = useState<Resultado[] | null>(null)
  const [progreso, setProgreso] = useState<{ votaron: number; total: number } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return }

      const res = await fetch(`/api/evaluaciones?partido_id=${partido_id}`)
      const data = await res.json()

      if (!res.ok) {
        setEstado(res.status === 403 ? 'not-participant' : 'closed')
        return
      }

      setPartido(data.partido)
      if (data.resultados) setResultados(data.resultados)
      if (data.progreso) setProgreso(data.progreso)

      if (!data.abierto) { setEstado(data.resultados ? 'already' : 'closed'); return }
      if (data.yaVoto)   { setEstado('already'); return }

      setCompañeros(data.compañeros)
      setEstado('open')
    })
  }, [supabase, partido_id])

  const toggleVoto = (categoriaId: string, playerId: string) => {
    setVotos(prev => {
      if (prev[categoriaId] === playerId) {
        const next = { ...prev }
        delete next[categoriaId]
        return next
      }
      return { ...prev, [categoriaId]: playerId }
    })
  }

  const votosCount = Object.keys(votos).length
  const thumbsCount = Object.keys(thumbs).length

  const setThumb = (id: string, value: 1 | -1) => {
    setThumbs(prev => {
      if (prev[id] === value) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: value }
    })
  }

  const enviar = async () => {
    setEnviando(true)
    const votosArr = Object.entries(votos).map(([categoria, votado_id]) => ({ categoria, votado_id }))
    const thumbsArr = Object.entries(thumbs).map(([votado_id, value]) => ({ votado_id, value }))
    const res = await fetch('/api/evaluaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id, votos: votosArr, thumbs: thumbsArr }),
    })
    const data = await res.json()
    if (res.ok) {
      setVotosFinales(votosCount)
      // If auto-closed (all voted), re-fetch to get resultados
      if (data.auto_cerrado) {
        const r2 = await fetch(`/api/evaluaciones?partido_id=${partido_id}`)
        const d2 = await r2.json()
        if (d2.resultados) setResultados(d2.resultados)
      }
      setEstado('done')
    } else {
      setMensaje(data.error ?? 'Error enviando votos.')
    }
    setEnviando(false)
  }

  // ── States ───────────────────────────────────────────────────────────────
  if (estado === 'loading') return (
    <FormCenterLayout>
      <LoadingSpinner text="CARGANDO..." />
    </FormCenterLayout>
  )

  if (estado === 'closed') return (
    <FormCenterLayout>
      <div style={{ textAlign: 'center', gap: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 48 }}>⏰</div>
        <div className="display" style={{ fontSize: 28 }}>Votación cerrada</div>
        <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Los reconocimientos de este partido no están disponibles.
        </div>
        <Link href="/" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }}>← Volver al inicio</Link>
      </div>
    </FormCenterLayout>
  )

  if (estado === 'not-participant') return (
    <FormCenterLayout>
      <div style={{ textAlign: 'center', gap: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 48 }}>🚫</div>
        <div className="display" style={{ fontSize: 28 }}>No participaste</div>
        <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Solo los jugadores confirmados pueden votar.
        </div>
        <Link href="/" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }}>← Volver al inicio</Link>
      </div>
    </FormCenterLayout>
  )

  if (estado === 'already') return (
    <div style={{ minHeight: '100vh', paddingBottom: 60 }}>
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
          <span className="display" style={{ fontSize: 18, letterSpacing: '0.08em' }}>RECONOCIMIENTOS</span>
          {partido && <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>{partido.dia_semana}</div>}
        </div>
      </nav>
      <div className="container" style={{ paddingTop: 32, maxWidth: 560 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div className="display" style={{ fontSize: 24, marginBottom: 8 }}>¡Ya votaste!</div>
          {resultados ? (
            <div className="mono" style={{ fontSize: 12, color: 'var(--green)' }}>Votación cerrada — estos son los ganadores:</div>
          ) : (
            <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Los reconocimientos se revelarán cuando cierre la votación.
              {progreso && ` (${progreso.votaron}/${progreso.total} votaron)`}
            </div>
          )}
        </div>
        {resultados && <ResultadosPanel resultados={resultados} />}
      </div>
    </div>
  )

  if (estado === 'done') return (
    <div style={{ minHeight: '100vh', paddingBottom: 60 }}>
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
          <span className="display" style={{ fontSize: 18, letterSpacing: '0.08em' }}>RECONOCIMIENTOS</span>
          {partido && <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>{partido.dia_semana}</div>}
        </div>
      </nav>
      <div className="container" style={{ paddingTop: 32, maxWidth: 560 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>🎉</div>
          <div className="display" style={{ fontSize: 28, marginBottom: 8 }}>¡Gracias!</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {votosFinales} reconocimiento{votosFinales !== 1 ? 's' : ''} enviado{votosFinales !== 1 ? 's' : ''}.
            {resultados
              ? ' Todos votaron — estos son los ganadores:'
              : ' Los badges se revelarán cuando todos voten o el admin cierre la votación.'}
          </div>
        </div>
        {resultados && <ResultadosPanel resultados={resultados} />}
        {!resultados && <Link href="/" className="btn btn-ghost" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>← Volver al inicio</Link>}
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 100 }}>
      {/* Nav */}
      <nav style={{
        borderBottom: '1px solid var(--border)', padding: '16px 0',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
      }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
            <span className="display" style={{ fontSize: 18, letterSpacing: '0.08em' }}>RECONOCIMIENTOS</span>
          </div>
          {partido && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {partido.dia_semana} {new Date(partido.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
            </div>
          )}
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 32, maxWidth: 560 }}>

        {/* Subtitle + progress */}
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 28, lineHeight: 1.7 }}>
          Vota por un compañero en cada categoría. Es anónimo y opcional.{' '}
          <span style={{ color: votosCount > 0 ? 'var(--green)' : 'var(--text-dim)' }}>
            {votosCount}/{CATEGORIAS.length} votadas.
          </span>
          {progreso && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
              · {progreso.votaron}/{progreso.total} jugadores votaron
            </span>
          )}
        </div>

        {mensaje && (
          <div style={{ marginBottom: 20 }}>
            <ErrorAlert message={mensaje} />
          </div>
        )}

        {/* Category cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CATEGORIAS.map(cat => {
            const winner = votos[cat.id]
              ? compañeros.find(c => c.id === votos[cat.id])
              : null

            return (
              <Card
                key={cat.id}
                padding="16px 20px"
                style={{
                  border: winner ? '1px solid #16a34a' : '1px solid var(--border)',
                  transition: 'border-color 0.15s',
                }}
              >
                {/* Category header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{cat.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{cat.nombre}</div>
                    {winner && (
                      <div className="mono" style={{ fontSize: 10, color: 'var(--green)', letterSpacing: '0.08em', marginTop: 2 }}>
                        ✓ {winner.username}
                      </div>
                    )}
                  </div>
                  {winner && <span style={{ color: 'var(--green)', fontSize: 18 }}>✓</span>}
                </div>

                {/* Player chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {compañeros.map(c => (
                    <PlayerChip
                      key={c.id}
                      p={c}
                      selected={votos[cat.id] === c.id}
                      onSelect={() => toggleVoto(cat.id, c.id)}
                    />
                  ))}
                </div>
              </Card>
            )
          })}
        </div>

        {/* Thumbs: rate every teammate */}
        <div style={{ marginTop: 28 }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 6 }}>
            ¿CÓMO JUGARON?
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>
            Pulgar arriba o abajo a cada compañero. Anónimo y opcional — ajusta el rating del equipo.
          </div>
          <ThumbsRater teammates={compañeros} values={thumbs} onSet={setThumb} />
        </div>
      </div>

      {/* Sticky send button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
        padding: '16px 24px', zIndex: 20,
      }}>
        <div className="container" style={{ maxWidth: 560 }}>
          {(() => {
            const total = votosCount + thumbsCount
            return (
              <button
                onClick={enviar}
                disabled={total === 0 || enviando}
                className="btn btn-primary"
                style={{
                  width: '100%', justifyContent: 'center',
                  padding: '14px', fontSize: 14,
                  opacity: total === 0 ? 0.4 : 1,
                }}
              >
                {enviando
                  ? 'Enviando...'
                  : total === 0
                    ? 'Vota o califica al menos a un compañero'
                    : `Enviar evaluación (${votosCount} 🏅 · ${thumbsCount} 👍👎)`}
              </button>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

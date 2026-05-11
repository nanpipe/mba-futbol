'use client'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { CATEGORIAS } from '@/lib/categorias'
import { PlayerAvatar } from '@/components/PlayerAvatar'

interface Compañero {
  id: string
  username: string
  avatar_url: string | null
  posicion: string
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

  const [estado, setEstado] = useState<'loading' | 'closed' | 'not-participant' | 'already' | 'open' | 'done'>('loading')
  const [compañeros, setCompañeros] = useState<Compañero[]>([])
  const [votos, setVotos] = useState<Record<string, string>>({})  // categoriaId → playerId
  const [partido, setPartido] = useState<{ fecha: string; dia_semana: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [votosFinales, setVotosFinales] = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return }

      const res = await fetch(`/api/evaluaciones?partido_id=${partido_id}`)
      const data = await res.json()

      if (!res.ok) {
        setEstado(res.status === 403 ? 'not-participant' : 'closed')
        return
      }

      if (!data.abierto) { setEstado('closed'); return }
      if (data.yaVoto)   { setEstado('already'); return }

      setPartido(data.partido)
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

  const enviar = async () => {
    setEnviando(true)
    const votosArr = Object.entries(votos).map(([categoria, votado_id]) => ({ categoria, votado_id }))
    const res = await fetch('/api/evaluaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id, votos: votosArr }),
    })
    const data = await res.json()
    if (res.ok) {
      setVotosFinales(votosCount)
      setEstado('done')
    } else {
      setMensaje(data.error ?? 'Error enviando votos.')
    }
    setEnviando(false)
  }

  // ── States ───────────────────────────────────────────────────────────────
  if (estado === 'loading') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13 }}>CARGANDO...</div>
    </div>
  )

  const centered = (children: React.ReactNode) => (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 24px', textAlign: 'center', gap: 16,
    }}>
      {children}
      <Link href="/" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }}>← Volver al inicio</Link>
    </div>
  )

  if (estado === 'closed') return centered(<>
    <div style={{ fontSize: 48 }}>⏰</div>
    <div className="display" style={{ fontSize: 28 }}>Votación cerrada</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
      Los reconocimientos de este partido no están disponibles.
    </div>
  </>)

  if (estado === 'not-participant') return centered(<>
    <div style={{ fontSize: 48 }}>🚫</div>
    <div className="display" style={{ fontSize: 28 }}>No participaste</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
      Solo los jugadores confirmados pueden votar.
    </div>
  </>)

  if (estado === 'already') return centered(<>
    <div style={{ fontSize: 48 }}>✅</div>
    <div className="display" style={{ fontSize: 28 }}>¡Ya votaste!</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
      Tus votos fueron enviados. Los reconocimientos se revelarán cuando el admin cierre la votación.
    </div>
  </>)

  if (estado === 'done') return centered(<>
    <div style={{ fontSize: 64 }}>🎉</div>
    <div className="display" style={{ fontSize: 32 }}>¡Gracias!</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
      Diste {votosFinales} reconocimiento{votosFinales !== 1 ? 's' : ''}.<br />
      Los badges se asignarán cuando el admin cierre la votación.
    </div>
  </>)

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

        {/* Subtitle */}
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 28, lineHeight: 1.7 }}>
          Vota por un compañero en cada categoría. Es anónimo y opcional.{' '}
          <span style={{ color: votosCount > 0 ? 'var(--green)' : 'var(--text-dim)' }}>
            {votosCount}/{CATEGORIAS.length} votadas.
          </span>
        </div>

        {mensaje && (
          <div className="mono" style={{
            fontSize: 13, color: 'var(--red)', padding: '10px 14px',
            background: '#2d0a0a', borderRadius: 3, border: '1px solid #7f1d1d', marginBottom: 20,
          }}>
            {mensaje}
          </div>
        )}

        {/* Category cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CATEGORIAS.map(cat => {
            const winner = votos[cat.id]
              ? compañeros.find(c => c.id === votos[cat.id])
              : null

            return (
              <div
                key={cat.id}
                className="card"
                style={{
                  padding: '16px 20px',
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
              </div>
            )
          })}
        </div>
      </div>

      {/* Sticky send button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
        padding: '16px 24px', zIndex: 20,
      }}>
        <div className="container" style={{ maxWidth: 560 }}>
          <button
            onClick={enviar}
            disabled={votosCount === 0 || enviando}
            className="btn btn-primary"
            style={{
              width: '100%', justifyContent: 'center',
              padding: '14px', fontSize: 14,
              opacity: votosCount === 0 ? 0.4 : 1,
            }}
          >
            {enviando
              ? 'Enviando...'
              : votosCount === 0
                ? 'Selecciona al menos un reconocimiento'
                : `Enviar ${votosCount} reconocimiento${votosCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

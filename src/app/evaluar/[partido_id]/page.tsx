'use client'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { posicionEmoji } from '@/lib/teamBalancer'

interface Compañero {
  id: string
  username: string
  avatar_url: string | null
  posicion: string
}

interface Rating {
  resistencia: number
  tecnica: number
  actitud: number
}

function StarRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', minWidth: 90 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              fontSize: 20, lineHeight: 1, background: 'none', border: 'none',
              cursor: 'pointer', padding: '2px 1px',
              color: n <= value ? 'var(--amber)' : 'var(--border)',
              transition: 'color 0.1s',
            }}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  )
}

function PlayerCard({ p, rating, onChange }: { p: Compañero; rating: Rating; onChange: (r: Partial<Rating>) => void }) {
  const complete = rating.resistencia > 0 && rating.tecnica > 0 && rating.actitud > 0
  return (
    <div className="card" style={{
      padding: '16px 20px',
      border: complete ? '1px solid #16a34a' : '1px solid var(--border)',
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: p.avatar_url ? 'transparent' : '#0f2d1a',
          border: '1px solid var(--border)', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
          {p.avatar_url
            ? <img src={p.avatar_url} alt={p.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span className="display" style={{ fontSize: 16, color: 'var(--green)', lineHeight: 1 }}>{p.username[0].toUpperCase()}</span>
          }
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{p.username}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {posicionEmoji(p.posicion)} {p.posicion}
          </div>
        </div>
        {complete && <span style={{ marginLeft: 'auto', color: 'var(--green)', fontSize: 18 }}>✓</span>}
      </div>

      <StarRow label="🏃 Resistencia" value={rating.resistencia} onChange={v => onChange({ resistencia: v })} />
      <StarRow label="🎯 Técnica" value={rating.tecnica} onChange={v => onChange({ tecnica: v })} />
      <StarRow label="💪 Actitud" value={rating.actitud} onChange={v => onChange({ actitud: v })} />
    </div>
  )
}

export default function EvaluarPage({ params }: { params: Promise<{ partido_id: string }> }) {
  const { partido_id } = use(params)
  const supabase = createClient()

  const [estado, setEstado] = useState<'loading' | 'closed' | 'not-participant' | 'already' | 'open' | 'done'>('loading')
  const [compañeros, setCompañeros] = useState<Compañero[]>([])
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [partido, setPartido] = useState<{ fecha: string; dia_semana: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState('')

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
      if (data.yaEvaluo) { setEstado('already'); return }

      setPartido(data.partido)
      setCompañeros(data.compañeros)
      const initial: Record<string, Rating> = {}
      for (const c of data.compañeros) initial[c.id] = { resistencia: 0, tecnica: 0, actitud: 0 }
      setRatings(initial)
      setEstado('open')
    })
  }, [supabase, partido_id])

  const updateRating = (playerId: string, partial: Partial<Rating>) => {
    setRatings(prev => ({ ...prev, [playerId]: { ...prev[playerId], ...partial } }))
  }

  const todosCompletos = compañeros.length > 0 &&
    compañeros.every(c => ratings[c.id]?.resistencia > 0 && ratings[c.id]?.tecnica > 0 && ratings[c.id]?.actitud > 0)

  const completados = compañeros.filter(c =>
    ratings[c.id]?.resistencia > 0 && ratings[c.id]?.tecnica > 0 && ratings[c.id]?.actitud > 0
  ).length

  const enviar = async () => {
    setEnviando(true)
    const evaluaciones = compañeros.map(c => ({
      evaluado_id: c.id,
      ...ratings[c.id],
    }))
    const res = await fetch('/api/evaluaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id, evaluaciones }),
    })
    const data = await res.json()
    if (res.ok) {
      setEstado('done')
    } else {
      setMensaje(data.error ?? 'Error enviando evaluaciones.')
    }
    setEnviando(false)
  }

  // ── States ──────────────────────────────────────────────────────────────
  if (estado === 'loading') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13 }}>CARGANDO...</div>
    </div>
  )

  const centered = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', gap: 16 }}>
      {children}
      <Link href="/" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }}>← Volver al inicio</Link>
    </div>
  )

  if (estado === 'closed') return centered(<>
    <div style={{ fontSize: 48 }}>⏰</div>
    <div className="display" style={{ fontSize: 28 }}>Evaluaciones cerradas</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Las evaluaciones de este partido no están disponibles.</div>
  </>)

  if (estado === 'not-participant') return centered(<>
    <div style={{ fontSize: 48 }}>🚫</div>
    <div className="display" style={{ fontSize: 28 }}>No participaste</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Solo los jugadores confirmados pueden evaluar.</div>
  </>)

  if (estado === 'already') return centered(<>
    <div style={{ fontSize: 48 }}>✅</div>
    <div className="display" style={{ fontSize: 28 }}>¡Ya evaluaste!</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Tus evaluaciones fueron enviadas. Los resultados se revelarán cuando el admin cierre la votación.</div>
  </>)

  if (estado === 'done') return centered(<>
    <div style={{ fontSize: 64 }}>🎉</div>
    <div className="display" style={{ fontSize: 32 }}>¡Gracias!</div>
    <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
      Evaluaste a {compañeros.length} compañero{compañeros.length !== 1 ? 's' : ''}.<br />
      Los badges se asignarán cuando el admin cierre la votación.
    </div>
  </>)

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 100 }}>
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
            <span className="display" style={{ fontSize: 18, letterSpacing: '0.08em' }}>EVALUAR</span>
          </div>
          {partido && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {partido.dia_semana} {new Date(partido.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
            </div>
          )}
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 32, maxWidth: 520 }}>
        {/* Progress */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              PROGRESO — {completados}/{compañeros.length}
            </div>
            <div className="mono" style={{ fontSize: 11, color: todosCompletos ? 'var(--green)' : 'var(--text-dim)' }}>
              {todosCompletos ? '¡Listo para enviar!' : `Faltan ${compañeros.length - completados}`}
            </div>
          </div>
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'var(--green)',
              width: `${compañeros.length > 0 ? (completados / compañeros.length) * 100 : 0}%`,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.5 }}>
          Las evaluaciones son anónimas. Sé honesto — ayudan a balancear los equipos.
        </div>

        {mensaje && (
          <div className="mono" style={{ fontSize: 13, color: 'var(--red)', padding: '10px 14px', background: '#2d0a0a', borderRadius: 3, border: '1px solid #7f1d1d', marginBottom: 20 }}>
            {mensaje}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {compañeros.map(c => (
            <PlayerCard
              key={c.id}
              p={c}
              rating={ratings[c.id] ?? { resistencia: 0, tecnica: 0, actitud: 0 }}
              onChange={partial => updateRating(c.id, partial)}
            />
          ))}
        </div>
      </div>

      {/* Sticky send button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
        padding: '16px 24px', zIndex: 20,
      }}>
        <div className="container" style={{ maxWidth: 520 }}>
          <button
            onClick={enviar}
            disabled={!todosCompletos || enviando}
            className="btn btn-primary"
            style={{
              width: '100%', justifyContent: 'center', padding: '14px',
              fontSize: 14, opacity: todosCompletos ? 1 : 0.4
            }}
          >
            {enviando ? 'Enviando...' : `Enviar ${compañeros.length} evaluaciones`}
          </button>
        </div>
      </div>
    </div>
  )
}

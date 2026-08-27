'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Shown to players while the lineup is still a draft: one tap to say whether it
 * looks even. A ✋ can carry a short reason, which the admin sees while fixing
 * the teams. Disappears once the admin confirms.
 */
export function AlineacionVoto({ partidoId }: { partidoId: string }) {
  const [miVoto, setMiVoto] = useState<number | null>(null)
  const [aFavor, setAFavor] = useState(0)
  const [enContra, setEnContra] = useState(0)
  const [comentario, setComentario] = useState('')
  const [abrirComentario, setAbrirComentario] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/alineacion-votos?partido_id=${partidoId}`)
      if (!res.ok) return
      const d = await res.json()
      setAFavor(d.aFavor ?? 0)
      setEnContra(d.enContra ?? 0)
      setMiVoto(d.miVoto?.voto ?? null)
      if (d.miVoto?.comentario) setComentario(d.miVoto.comentario)
    } catch { /* the panel is informative — never block the page */ }
  }, [partidoId])

  useEffect(() => { cargar() }, [cargar])

  const votar = async (voto: 1 | -1, texto?: string) => {
    setEnviando(true)
    setError('')
    const res = await fetch('/api/alineacion-votos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partido_id: partidoId, voto, comentario: texto }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setError(d.error ?? 'No se pudo enviar tu voto')
    else {
      setMiVoto(voto)
      setAbrirComentario(false)
      await cargar()
    }
    setEnviando(false)
  }

  const btn = (activo: boolean, color: string): React.CSSProperties => ({
    flex: 1, padding: '10px 12px', borderRadius: 4, cursor: enviando ? 'default' : 'pointer',
    background: activo ? 'rgba(255,255,255,0.06)' : 'none',
    border: `1px solid ${activo ? color : 'var(--border)'}`,
    color: activo ? color : 'var(--text-muted)',
    fontSize: 12,
  })

  return (
    <div style={{
      marginTop: 14, padding: '14px 16px',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 10 }}>
        ¿LA VES PAREJA?
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="mono"
          disabled={enviando}
          onClick={() => votar(1)}
          style={btn(miVoto === 1, 'var(--green)')}
        >
          👍 Está pareja
        </button>
        <button
          className="mono"
          disabled={enviando}
          onClick={() => { setAbrirComentario(true); if (miVoto !== -1) votar(-1, comentario || undefined) }}
          style={btn(miVoto === -1, 'var(--amber)')}
        >
          ✋ Despareja
        </button>
      </div>

      {(abrirComentario || miVoto === -1) && (
        <div style={{ marginTop: 10 }}>
          <input
            type="text"
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            placeholder="¿Por qué? (opcional)"
            maxLength={200}
            onKeyDown={e => e.key === 'Enter' && votar(-1, comentario)}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
          />
          <button
            onClick={() => votar(-1, comentario)}
            disabled={enviando}
            className="btn btn-ghost"
            style={{ marginTop: 8, fontSize: 11, padding: '7px 14px' }}
          >
            {enviando ? 'Enviando...' : 'Enviar comentario'}
          </button>
        </div>
      )}

      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 10 }}>
        👍 {aFavor} · ✋ {enContra}
        {miVoto !== null && <span style={{ color: 'var(--green)', marginLeft: 8 }}>✓ tu voto quedó</span>}
      </div>

      {error && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{error}</div>
      )}
    </div>
  )
}

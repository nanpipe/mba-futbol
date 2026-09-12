'use client'

import { useCallback, useEffect, useState } from 'react'

// "¿Se jugó el partido?" — shown to admins one hour after kickoff, on the home
// screen and at the top of the admin panel, until the match has an answer and
// a score. One place for the whole close-out: played or not, score, photo.
// Answering "Sí" opens the evaluaciones immediately.

interface PartidoCierre {
  id: string
  fecha: string
  dia_semana: string
  tipo?: 'normal' | 'minitorneo'
  jugado: boolean | null
  resultado: string | null
  foto_url: string | null
  evaluaciones_abiertas: boolean
}

interface Pendiente {
  partido: PartidoCierre
  confirmados: number
  auto_jugado_min: number
}

async function postAdmin(payload: Record<string, unknown>): Promise<{ ok: boolean; mensaje?: string; error?: string }> {
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, ...data }
  } catch {
    return { ok: false, error: 'Error de conexión. Intenta de nuevo.' }
  }
}

const scoreInput: React.CSSProperties = { width: '4rem', padding: '8px 10px', textAlign: 'center', fontSize: 22, fontWeight: 700 }
const scoreLabel: React.CSSProperties = { fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }

export function CierrePartidoCard({ onDone }: { onDone?: () => void }) {
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [golesA, setGolesA] = useState('')
  const [golesB, setGolesB] = useState('')
  const [ptsB, setPtsB] = useState('')
  const [ptsN, setPtsN] = useState('')
  const [ptsM, setPtsM] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState('')

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/admin?accion=cierre_pendiente')
      if (!res.ok) { setPendiente(null); return }
      const data = await res.json()
      setPendiente(data.partido ? data as Pendiente : null)
    } catch {
      setPendiente(null)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    if (!foto) { setPreview(null); return }
    const url = URL.createObjectURL(foto)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [foto])

  if (hecho) {
    return (
      <div className="mono fade-in" style={{
        fontSize: 13, padding: '14px 18px', borderRadius: 6, marginBottom: 32,
        background: '#0f2d1a', border: '1px solid #16a34a', color: 'var(--green)', lineHeight: 1.5,
      }}>
        {hecho}
      </div>
    )
  }

  if (!pendiente) return null

  const p = pendiente.partido
  const esMini = p.tipo === 'minitorneo'
  const yaJugado = p.jugado === true
  const lleno = pendiente.confirmados > pendiente.auto_jugado_min
  const fechaTxt = new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })

  const responderSi = async () => {
    setSaving(true)
    setError('')
    const r = await postAdmin({ accion: 'cerrar_partido', partido_id: p.id, jugado: true })
    setSaving(false)
    if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return }
    await cargar()
    onDone?.()
  }

  const responderNo = async () => {
    if (!window.confirm(`¿Confirmas que el partido del ${p.dia_semana} NO se jugó? No se abren votaciones.`)) return
    setSaving(true)
    setError('')
    const r = await postAdmin({ accion: 'cerrar_partido', partido_id: p.id, jugado: false })
    setSaving(false)
    if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return }
    setHecho(r.mensaje ?? 'Marcado como no jugado.')
    onDone?.()
  }

  const guardarResultado = async () => {
    const completo = esMini ? [ptsB, ptsN, ptsM].every(v => v !== '') : golesA !== '' && golesB !== ''
    if (!completo) { setError('Pon el marcador de todos los equipos.'); return }
    setSaving(true)
    setError('')
    try {
      if (foto) {
        const form = new FormData()
        form.append('partido_id', p.id)
        form.append('file', foto)
        const res = await fetch('/api/admin/foto', { method: 'POST', body: form })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error ?? 'No se pudo subir la foto.')
          return
        }
      }
      const r = await postAdmin({
        accion: 'cerrar_partido',
        partido_id: p.id,
        jugado: true,
        ...(esMini
          ? { puntos_blanco: ptsB, puntos_negro: ptsN, puntos_morado: ptsM }
          : { goles_a: golesA, goles_b: golesB }),
      })
      if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return }
      setHecho(`✓ ${r.mensaje ?? 'Resultado guardado.'}`)
      onDone?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-in" style={{
      background: '#130f00', border: '1px solid #5a4200',
      borderRadius: 6, padding: '18px 20px', marginBottom: 32,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{yaJugado ? '✅' : '⚽'}</span>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--amber)' }}>
          {yaJugado ? 'PARTIDO JUGADO — FALTA EL MARCADOR' : '¿SE JUGÓ EL PARTIDO?'}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
        {p.dia_semana} {fechaTxt} · {pendiente.confirmados} confirmados
        {yaJugado && p.evaluaciones_abiertas && <span style={{ color: '#a78bfa' }}> · votaciones abiertas</span>}
      </div>

      {!yaJugado ? (
        <>
          {lleno && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
              Con más de {pendiente.auto_jugado_min} confirmados lo damos por jugado.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={responderSi} disabled={saving} className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 13 }}>
              {saving ? '...' : 'Sí, se jugó'}
            </button>
            <button
              onClick={responderNo}
              disabled={saving}
              className="btn btn-ghost"
              style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-muted)' }}
            >
              No se jugó
            </button>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
            &quot;Sí&quot; abre las votaciones y avisa a los confirmados.
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Score */}
          {esMini ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {([
                { label: '⬜ Blancos', val: ptsB, set: setPtsB },
                { label: '⬛ Negros', val: ptsN, set: setPtsN },
                { label: '🟣 Morados', val: ptsM, set: setPtsM },
              ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                <div key={label}>
                  <div className="mono" style={scoreLabel}>{label}</div>
                  <input type="number" inputMode="numeric" min="0" max="99" value={val} onChange={e => set(e.target.value)} style={scoreInput} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <div className="mono" style={scoreLabel}>🤍 Blancos</div>
                <input type="number" inputMode="numeric" min="0" max="99" value={golesA} onChange={e => setGolesA(e.target.value)} style={scoreInput} />
              </div>
              <div className="mono" style={{ fontSize: 20, color: 'var(--text-dim)', paddingBottom: 8 }}>–</div>
              <div>
                <div className="mono" style={scoreLabel}>🖤 Negros</div>
                <input type="number" inputMode="numeric" min="0" max="99" value={golesB} onChange={e => setGolesB(e.target.value)} style={scoreInput} />
              </div>
            </div>
          )}

          {/* Photo */}
          <div>
            {(preview || p.foto_url) && (
              <div style={{ marginBottom: 10, borderRadius: 4, overflow: 'hidden', maxWidth: 340 }}>
                <img src={preview ?? p.foto_url!} alt="Foto del partido" style={{ width: '100%', display: 'block', maxHeight: 200, objectFit: 'cover' }} />
              </div>
            )}
            <label className="mono" style={{
              display: 'inline-block', padding: '8px 16px', fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-card)',
              color: 'var(--text)', letterSpacing: '0.05em',
            }}>
              {foto || p.foto_url ? '📷 Cambiar foto' : '📷 Subir foto'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                disabled={saving}
                onChange={e => setFoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={guardarResultado} disabled={saving} className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 13 }}>
              {saving ? 'Guardando...' : 'Guardar resultado'}
            </button>
            <button
              onClick={responderNo}
              disabled={saving}
              className="mono"
              style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              En realidad no se jugó
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--red)', marginTop: 12 }}>{error}</div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import { DEFAULT_BADGES, type Badge, type BadgeSigno } from '@/lib/categorias'
import { DEFAULT_TIERS, TIER_LOOKS, ratingTierStyle, type TierConfig } from '@/lib/tier'

const SIGNOS: { id: BadgeSigno; label: string; color: string; hint: string }[] = [
  { id: 'positivo', label: '+ Sube',  color: 'var(--green)',     hint: 'Sube el puntaje del jugador' },
  { id: 'negativo', label: '− Baja',  color: 'var(--red)',       hint: 'Baja el puntaje del jugador' },
  { id: 'neutral',  label: '= Nada',  color: 'var(--text-dim)',  hint: 'Solo decorativa, no afecta el puntaje' },
]

// Combining diacritics, written as an escape so the source stays plain ASCII.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

function Feedback({ result }: { result: { ok: boolean; msg: string } | null }) {
  if (!result) return null
  return (
    <div className="mono" style={{
      fontSize: 12, marginTop: 12, padding: '8px 12px', borderRadius: 3,
      ...(result.ok
        ? { color: 'var(--green)', background: '#0f2d1a', border: '1px solid #16a34a' }
        : { color: 'var(--red)', background: '#2d0a0a', border: '1px solid #7f1d1d' }),
    }}>
      {result.msg}
    </div>
  )
}

// ── Insignias ────────────────────────────────────────────────────────────────
export function BadgesEditor({ badges, onChange }: { badges: Badge[]; onChange: (b: Badge[]) => void }) {
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const update = (i: number, patch: Partial<Badge>) => {
    setResult(null)
    onChange(badges.map((b, idx) => idx === i ? { ...b, ...patch } : b))
  }

  const eliminar = (i: number) => {
    setResult(null)
    onChange(badges.filter((_, idx) => idx !== i))
  }

  const agregar = () => {
    setResult(null)
    onChange([...badges, { id: `nueva_${Date.now().toString(36)}`, emoji: '🏅', nombre: '', signo: 'positivo' }])
  }

  const guardar = async () => {
    // Derive ids from names for new badges so they read well in the DB. Existing
    // badges keep their id — changing it would orphan already-awarded badges.
    const payload = badges.map(b => ({
      ...b,
      nombre: b.nombre.trim(),
      id: b.id.startsWith('nueva_') && b.nombre.trim() ? (slugify(b.nombre) || b.id) : b.id,
    }))
    if (payload.some(b => !b.nombre)) {
      setResult({ ok: false, msg: 'Toda insignia necesita un nombre.' })
      return
    }
    const ids = new Set(payload.map(b => b.id))
    if (ids.size !== payload.length) {
      setResult({ ok: false, msg: 'Hay insignias con el mismo nombre. Deben ser distintas.' })
      return
    }
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'guardar_badges', badges: payload }),
    })
    const data = await res.json()
    if (res.ok && Array.isArray(data.badges)) onChange(data.badges)
    setResult({ ok: res.ok, msg: data.mensaje ?? data.error ?? 'Error desconocido' })
    setSaving(false)
  }

  return (
    <Card padding="20px 24px">
      <SectionHeader title="INSIGNIAS" icon="🏅" color="var(--amber)" />
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
        Reconocimientos que los jugadores votan después del partido. Las positivas suben
        el puntaje, las negativas lo bajan y las neutrales solo decoran.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {badges.map((b, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '10px 12px', background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 6,
          }}>
            <input
              type="text"
              value={b.emoji}
              onChange={e => update(i, { emoji: e.target.value })}
              aria-label="Emoji"
              style={{ width: 56, textAlign: 'center', fontSize: 18, flexShrink: 0 }}
            />
            <input
              type="text"
              value={b.nombre}
              placeholder="Nombre de la insignia"
              onChange={e => update(i, { nombre: e.target.value })}
              aria-label="Nombre"
              style={{ flex: 1, minWidth: 140 }}
            />
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {SIGNOS.map(s => (
                <button
                  key={s.id}
                  onClick={() => update(i, { signo: s.id })}
                  title={s.hint}
                  className="mono"
                  style={{
                    fontSize: 10, padding: '6px 9px', borderRadius: 3, cursor: 'pointer',
                    background: b.signo === s.id ? 'var(--bg-hover, rgba(255,255,255,0.06))' : 'none',
                    border: `1px solid ${b.signo === s.id ? s.color : 'var(--border)'}`,
                    color: b.signo === s.id ? s.color : 'var(--text-dim)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => eliminar(i)}
              title="Eliminar insignia"
              className="mono"
              style={{
                fontSize: 14, padding: '5px 9px', borderRadius: 3, cursor: 'pointer',
                background: 'none', border: '1px solid var(--border)', color: 'var(--red)', flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={agregar} className="btn btn-ghost" style={{ fontSize: 12, padding: '9px 16px' }}>
          + Añadir insignia
        </button>
        <button onClick={guardar} disabled={saving} className="btn btn-primary" style={{ fontSize: 12, padding: '9px 20px' }}>
          {saving ? 'Guardando...' : 'Guardar insignias'}
        </button>
        <button
          onClick={() => { setResult(null); onChange(DEFAULT_BADGES.map(b => ({ ...b }))) }}
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '9px 16px', color: 'var(--text-dim)' }}
        >
          Restaurar por defecto
        </button>
      </div>

      <Feedback result={result} />

      <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.6 }}>
        Al eliminar una insignia, las ya otorgadas se conservan en el historial pero deja de
        poderse votar. Renombrarla no afecta las anteriores.
      </div>
    </Card>
  )
}

// ── Rangos de rating ─────────────────────────────────────────────────────────
export function TiersEditor({ tiers, onChange }: { tiers: TierConfig[]; onChange: (t: TierConfig[]) => void }) {
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const sorted = [...tiers].sort((a, b) => b.min - a.min)

  const update = (i: number, patch: Partial<TierConfig>) => {
    setResult(null)
    onChange(sorted.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }

  const eliminar = (i: number) => {
    setResult(null)
    onChange(sorted.filter((_, idx) => idx !== i))
  }

  const agregar = () => {
    setResult(null)
    onChange([...sorted, { min: 3.0, label: '', emoji: '⚽', look: 'plata' }])
  }

  const guardar = async () => {
    const payload = sorted.map(t => ({ ...t, label: t.label.trim() }))
    if (payload.some(t => !t.label)) {
      setResult({ ok: false, msg: 'Todo rango necesita un nombre.' })
      return
    }
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'guardar_tiers', tiers: payload }),
    })
    const data = await res.json()
    if (res.ok && Array.isArray(data.tiers)) onChange(data.tiers)
    setResult({ ok: res.ok, msg: data.mensaje ?? data.error ?? 'Error desconocido' })
    setSaving(false)
  }

  return (
    <Card padding="20px 24px">
      <SectionHeader title="RANGOS DE PUNTAJE" icon="⭐" color="#a78bfa" />
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
        Nombre que recibe cada jugador según su puntaje (1.0 a 5.0). El &quot;desde&quot; es el mínimo
        para entrar al rango; el más bajo siempre arranca en 1.0.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map((t, i) => {
          const esUltimo = i === sorted.length - 1
          const hasta = i === 0 ? 5 : sorted[i - 1].min
          const preview = ratingTierStyle(t.min, sorted)
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '10px 12px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}>
              {/* Look swatch */}
              <div style={{
                width: 34, height: 34, borderRadius: 4, flexShrink: 0,
                background: preview.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15,
              }}>
                {t.emoji}
              </div>
              <input
                type="text"
                value={t.emoji}
                onChange={e => update(i, { emoji: e.target.value })}
                aria-label="Emoji"
                style={{ width: 52, textAlign: 'center', fontSize: 16, flexShrink: 0 }}
              />
              <input
                type="text"
                value={t.label}
                placeholder="Nombre del rango"
                onChange={e => update(i, { label: e.target.value })}
                aria-label="Nombre del rango"
                style={{ flex: 1, minWidth: 120 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>desde</span>
                <input
                  type="number"
                  min={1} max={5} step={0.1}
                  value={esUltimo ? 1 : t.min}
                  disabled={esUltimo}
                  onChange={e => update(i, { min: parseFloat(e.target.value) })}
                  aria-label="Puntaje mínimo"
                  style={{ width: 68, opacity: esUltimo ? 0.5 : 1 }}
                />
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  a {hasta.toFixed(1)}
                </span>
              </div>
              <select
                value={t.look}
                onChange={e => update(i, { look: e.target.value })}
                aria-label="Color"
                style={{ width: 100, flexShrink: 0 }}
              >
                {Object.entries(TIER_LOOKS).map(([id, look]) => (
                  <option key={id} value={id}>{look.label}</option>
                ))}
              </select>
              <button
                onClick={() => eliminar(i)}
                title="Eliminar rango"
                className="mono"
                style={{
                  fontSize: 14, padding: '5px 9px', borderRadius: 3, cursor: 'pointer',
                  background: 'none', border: '1px solid var(--border)', color: 'var(--red)', flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={agregar} className="btn btn-ghost" style={{ fontSize: 12, padding: '9px 16px' }}>
          + Añadir rango
        </button>
        <button onClick={guardar} disabled={saving} className="btn btn-primary" style={{ fontSize: 12, padding: '9px 20px' }}>
          {saving ? 'Guardando...' : 'Guardar rangos'}
        </button>
        <button
          onClick={() => { setResult(null); onChange(DEFAULT_TIERS.map(t => ({ ...t }))) }}
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '9px 16px', color: 'var(--text-dim)' }}
        >
          Restaurar por defecto
        </button>
      </div>

      <Feedback result={result} />
    </Card>
  )
}

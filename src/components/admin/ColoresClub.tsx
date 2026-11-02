'use client'

import { useState } from 'react'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import {
  FONDOS, MUESTRAS_ACENTO, MUESTRAS_PRIMARIO, TEMA_DEFAULT,
  chequeosTema, derivarTokens, esTemaDefault, type FondoTema, type Tema,
} from '@/lib/tema'

/**
 * Colores del club (Ajustes → Club, solo superadmin).
 *
 * La vista previa pinta las variables SOLO dentro de su caja: probar colores no
 * repinta el panel. Al guardar se recarga la página, porque el tema real lo
 * pone el servidor en el <head> (layout.tsx) y así se ve igual que lo verá el
 * club.
 */
export function ColoresClub({ inicial, clubNombre }: { inicial: Tema; clubNombre: string }) {
  const [tema, setTema] = useState<Tema>(inicial)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const tokens = derivarTokens(tema)
  const chequeos = chequeosTema(tema)
  const cambio = tema.primario !== inicial.primario || tema.acento !== inicial.acento || tema.fondo !== inicial.fondo

  const guardar = async () => {
    setGuardando(true)
    setError('')
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'guardar_tema', tema }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error ?? 'No se pudieron guardar los colores'); setGuardando(false); return }
      window.location.reload()
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
      setGuardando(false)
    }
  }

  // Nombre del club en dos partes, como en la barra del inicio: la última
  // palabra va en el color principal.
  const partes = clubNombre.trim().split(/\s+/)
  const ultima = partes.length > 1 ? partes.pop() : ''

  return (
    <Card padding="20px 24px">
      <SectionHeader title="COLORES DEL CLUB" icon="🎨" color="var(--primary)" />
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 18 }}>
        El principal va en botones, selección y el nombre del club. El verde de &ldquo;subió&rdquo;,
        el rojo de &ldquo;bajó&rdquo; y los colores de equipo no cambian.
      </p>

      <Etiqueta>PRINCIPAL</Etiqueta>
      <Muestras lista={MUESTRAS_PRIMARIO} valor={tema.primario} onElegir={c => setTema(t => ({ ...t, primario: c }))} nombre="principal" />

      <Etiqueta>ACENTO</Etiqueta>
      <Muestras lista={MUESTRAS_ACENTO} valor={tema.acento} onElegir={c => setTema(t => ({ ...t, acento: c }))} nombre="acento" />

      <Etiqueta>FONDO</Etiqueta>
      <div role="radiogroup" aria-label="Fondo" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {(Object.keys(FONDOS) as FondoTema[]).map(f => {
          const sel = tema.fondo === f
          return (
            <button
              key={f}
              role="radio"
              aria-checked={sel}
              onClick={() => setTema(t => ({ ...t, fondo: f }))}
              style={{
                flex: '1 1 90px', minHeight: 44, borderRadius: 8, cursor: 'pointer', fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: sel ? 'var(--bg-elevated)' : 'none',
                border: `1px solid ${sel ? 'var(--text-muted)' : 'var(--border-light)'}`,
                color: sel ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 7, background: FONDOS[f].card, border: '1px solid var(--border-light)' }} />
              {FONDOS[f].nombre}
            </button>
          )
        })}
      </div>

      {/* ── Vista previa: las variables solo valen dentro de esta caja ── */}
      <Etiqueta>ASÍ SE VE</Etiqueta>
      <div style={{ ...(tokens as React.CSSProperties), background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span className="display" style={{ fontSize: 20, letterSpacing: '0.1em', color: 'var(--text)' }}>
            {partes.join(' ')}{ultima && <> <span style={{ color: 'var(--primary)' }}>{ultima}</span></>}
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', letterSpacing: '0.08em' }}>ADMIN</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 8 }}>CUPOS <span style={{ color: 'var(--primary)' }}>13</span>/14</div>
            <div style={{ display: 'flex', gap: 3 }}>
              {Array.from({ length: 14 }, (_, i) => (
                <div key={i} style={{ flex: 1, height: 5, borderRadius: 6, background: i < 13 ? 'var(--primary)' : 'var(--border)' }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--primary-soft)', border: '1px solid var(--primary-line)' }}>
            <span style={{ fontSize: 14, color: 'var(--text)', flex: 1 }}>juli9</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--primary)' }}>TÚ</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--pos)' }}>+0.02</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--red)' }}>−0.02</span>
          </div>
          <button type="button" tabIndex={-1} className="btn btn-primary" style={{ width: '100%', minHeight: 44 }}>Inscribirse al partido</button>
        </div>
      </div>

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {chequeos.map(c => (
          <li key={c.texto} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, lineHeight: 1.4 }}>
            <span style={{ color: 'var(--text-muted)' }}>{c.texto}</span>
            <span className="mono" style={{ fontSize: 12, color: c.ok ? 'var(--pos)' : 'var(--amber)', textAlign: 'right' }}>
              {c.ok ? '✓' : '⚠'} {c.detalle}
            </span>
          </li>
        ))}
      </ul>

      {error && <div className="mono" style={{ fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={guardar}
          disabled={!cambio || guardando}
          className="btn btn-primary"
          style={{ flex: '2 1 160px', minHeight: 44 }}
        >
          {guardando ? 'Guardando...' : 'Guardar colores'}
        </button>
        <button
          onClick={() => setTema(TEMA_DEFAULT)}
          disabled={esTemaDefault(tema) || guardando}
          className="btn btn-ghost"
          style={{ flex: '1 1 110px', minHeight: 44 }}
        >
          Restaurar
        </button>
      </div>
      <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginTop: 12 }}>
        Los jugadores lo ven al abrir la app (puede tardar hasta un minuto). La barra del
        celular y el ícono de la app instalada cambian solo al reinstalarla.
      </p>
    </Card>
  )
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function Muestras({ lista, valor, onElegir, nombre }: {
  lista: string[]; valor: string; onElegir: (c: string) => void; nombre: string
}) {
  const propio = !lista.includes(valor)
  return (
    <div role="radiogroup" aria-label={`Color ${nombre}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
      {lista.map(c => {
        const sel = c === valor
        return (
          <button
            key={c}
            role="radio"
            aria-checked={sel}
            aria-label={c}
            onClick={() => onElegir(c)}
            style={{
              width: 44, height: 44, borderRadius: 22, cursor: 'pointer', padding: 0,
              background: c,
              border: '2px solid var(--bg-card)',
              boxShadow: sel ? '0 0 0 2px var(--text)' : '0 0 0 1px var(--border-light)',
            }}
          />
        )
      })}
      {/* Otro color: el selector nativo del sistema. */}
      <label
        title="Otro color"
        style={{
          width: 44, height: 44, borderRadius: 22, cursor: 'pointer', position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: propio ? valor : 'var(--bg-elevated)',
          border: '2px solid var(--bg-card)',
          boxShadow: propio ? '0 0 0 2px var(--text)' : '0 0 0 1px var(--border-light)',
          color: 'var(--text-muted)', fontSize: 20,
        }}
      >
        {!propio && '+'}
        <input
          type="color"
          value={valor}
          onChange={e => onElegir(e.target.value.toLowerCase())}
          aria-label={`Otro color ${nombre}`}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
        />
      </label>
    </div>
  )
}

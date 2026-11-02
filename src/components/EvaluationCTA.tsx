'use client'

import Link from 'next/link'

export function EvaluationCTA({ partidoId, title, subtitle }: { partidoId: string; title: string; subtitle: string }) {
  return (
    <div style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn-line)', borderRadius: 6, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <span className="display" style={{ fontSize: 18, letterSpacing: '0.05em' }}>{title}</span>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {subtitle}
        </div>
      </div>
      <Link
        href={`/evaluar/${partidoId}`}
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: '10px 20px', color: 'var(--amber)', borderColor: 'var(--warn-line)', whiteSpace: 'nowrap' }}
      >
        Evaluar ahora →
      </Link>
    </div>
  )
}

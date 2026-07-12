'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { MatchResultCard, type MatchBadge, type MatchResult } from '@/components/MatchResultCard'

interface PartidoHistorial extends MatchResult {
  id: string
  resultado?: string | null
  player_badges: MatchBadge[]
}

// Player-facing match history: results, winner, recognitions and photo of past
// matches (read-only mirror of what admins see in TabHistorial).
export default function HistorialPage() {
  const supabase = createClient()
  const [partidos, setPartidos] = useState<PartidoHistorial[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return }

      const hoy = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('partidos')
        .select('id, fecha, dia_semana, hora, resultado, goles_a, goles_b, tipo, lugar, puntos_blanco, puntos_negro, puntos_morado, foto_url, player_badges(badge_id, badge_emoji, badge_nombre, profiles!player_badges_player_id_fkey(username))')
        .lt('fecha', hoy)
        .order('fecha', { ascending: false })
        .limit(20)

      setPartidos((data as unknown as PartidoHistorial[]) ?? [])
      setLoading(false)
    })
  }, [supabase])

  // Only matches with something to show (result, badges or photo)
  const conContenido = partidos.filter(p =>
    p.foto_url || (p.player_badges?.length ?? 0) > 0 ||
    (p.goles_a != null && p.goles_b != null) || p.puntos_blanco != null
  )

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 60 }}>
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 30 }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
          <span className="display" style={{ fontSize: 18, letterSpacing: '0.08em' }}>HISTORIAL</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 32, maxWidth: 560 }}>
        {loading ? (
          <LoadingSpinner text="CARGANDO..." />
        ) : conContenido.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Aún no hay partidos con resultados registrados.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
            {conContenido.map(p => (
              <MatchResultCard
                key={p.id}
                titulo={`${p.tipo === 'minitorneo' ? '🏆 MINITORNEO — ' : ''}${p.dia_semana.toUpperCase()}`}
                partido={p}
                badges={p.player_badges ?? []}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

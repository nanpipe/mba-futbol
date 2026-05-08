'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// ── Questions ──────────────────────────────────────────────────────────────────

interface Question {
  q: string
  opts: string[]
}

const SECTIONS: { key: string; label: string; emoji: string; color: string; questions: Question[] }[] = [
  {
    key: 'res',
    label: 'Resistencia',
    emoji: '🏃',
    color: '#22d3ee',
    questions: [
      {
        q: '¿Cuánto tiempo puedes mantener buen ritmo sin agotarte demasiado?',
        opts: ['Menos de 15 min', '15 a 30 min', '30 a 45 min', 'Todo el partido, bajando ritmo', 'Todo el partido con intensidad alta'],
      },
      {
        q: 'Después de una carrera fuerte o sprint, ¿cómo te recuperas?',
        opts: ['Me cuesta mucho recuperarme', 'Necesito varios minutos', 'Me recupero en poco tiempo', 'Me recupero rápido', 'Repito esfuerzos constantemente sin problema'],
      },
      {
        q: '¿Con qué frecuencia haces recorridos largos para apoyar ataque y defensa?',
        opts: ['Casi nunca', 'Pocas veces por partido', 'Algunas veces', 'Muchas veces', 'Todo el partido, ida y vuelta'],
      },
      {
        q: 'Cuando el partido se vuelve más intenso, normalmente:',
        opts: ['Bajo mucho el rendimiento', 'Me cuesta seguir el ritmo', 'Me mantengo a un nivel aceptable', 'Respondo bien a la exigencia', 'Me crezco y aumento el ritmo'],
      },
      {
        q: '¿Con qué frecuencia haces actividad física adicional al fútbol?',
        opts: ['Nunca', '1 vez por semana', '2 veces por semana', '3 veces por semana', '4 o más veces por semana'],
      },
    ],
  },
  {
    key: 'fis',
    label: 'Físico',
    emoji: '💪',
    color: '#f97316',
    questions: [
      {
        q: 'En disputas aéreas o cabezazos, normalmente:',
        opts: ['Casi nunca salto o gano', 'Pierdo la mayoría', 'Gano algunas', 'Gano muchas', 'Soy dominante en el juego aéreo'],
      },
      {
        q: 'En choques cuerpo a cuerpo y balones divididos, normalmente:',
        opts: ['Evito el contacto físico', 'Pierdo la mayoría', 'Gano algunas', 'Gano muchas', 'Soy muy difícil de superar físicamente'],
      },
      {
        q: 'Tu presencia física comparada con los rivales en MBA es:',
        opts: ['Mucho más pequeño o débil', 'Un poco por debajo', 'Similar a la mayoría', 'Por encima de la mayoría', 'Soy de los más fuertes o imponentes'],
      },
      {
        q: 'Cuando proteges el balón con el cuerpo (espalda al arco), normalmente:',
        opts: ['Me lo quitan fácil', 'Me cuesta sostenerlo', 'Lo sostengo algunas veces', 'Lo protejo bien bajo presión', 'Soy muy difícil de sacar del balón'],
      },
      {
        q: 'Tu complexión física te da ventaja en:',
        opts: ['No siento que me dé ventaja', 'A veces en alguna situación', 'En disputas de vez en cuando', 'Frecuentemente en duelos directos', 'Constantemente — es una de mis fortalezas'],
      },
    ],
  },
  {
    key: 'def',
    label: 'Defensa',
    emoji: '🛡️',
    color: '#60a5fa',
    questions: [
      {
        q: 'Cuando tu equipo pierde el balón, normalmente tú:',
        opts: ['Me quedo arriba', 'Bajo solo si estoy cerca', 'Regreso a mi posición', 'Regreso rápido a marcar', 'Soy de los primeros en recuperar posición'],
      },
      {
        q: 'En un uno contra uno defendiendo, normalmente:',
        opts: ['Me superan fácil', 'Me cuesta sostener la marca', 'A veces freno la jugada', 'Cierro espacios e incomodo', 'Gano o fuerzo el error del rival'],
      },
      {
        q: '¿Qué tan atento estás a marcar jugadores libres?',
        opts: ['Casi nunca me fijo', 'Me fijo tarde', 'Me fijo a veces', 'Estoy pendiente de los rivales', 'Corrijo marcas y espacios constantemente'],
      },
      {
        q: 'Cuando un compañero pierde la marca, tú:',
        opts: ['No reacciono', 'Reacciono tarde', 'Cubro si puedo', 'Cubro rápido', 'Anticipo y ayudo constantemente'],
      },
      {
        q: 'En presión alta o robo de balón, normalmente:',
        opts: ['No presiono casi nunca', 'Presiono poco', 'Presiono algunas veces', 'Presiono bien y molesto', 'Soy agresivo presionando y recupero balones'],
      },
    ],
  },
  {
    key: 'ata',
    label: 'Ataque',
    emoji: '⚡',
    color: '#facc15',
    questions: [
      {
        q: 'Cuando tu equipo tiene el balón, normalmente tú:',
        opts: ['Me quedo quieto', 'Me muevo poco', 'Busco espacios a veces', 'Me desmarco constantemente', 'Siempre genero opciones de pase'],
      },
      {
        q: '¿Qué tan seguido participas en jugadas de gol?',
        opts: ['Casi nunca', 'Pocas veces', 'Algunas veces', 'Frecuentemente', 'Casi siempre estoy involucrado'],
      },
      {
        q: 'Cuando estás cerca del área rival, normalmente:',
        opts: ['No sé qué hacer', 'Paso rápido para no complicarme', 'Intento asociarme', 'Busco pase, pared o remate', 'Soy decisivo y genero peligro real'],
      },
      {
        q: '¿Qué tan bien decides cuándo pasar, avanzar o rematar?',
        opts: ['Me cuesta decidir', 'Decido tarde o mal', 'Decido aceptablemente', 'Tomo buenas decisiones', 'Leo muy bien la jugada y decido rápido'],
      },
      {
        q: '¿Con qué frecuencia haces goles o asistencias?',
        opts: ['Casi nunca', 'De vez en cuando', 'Algunas veces', 'Frecuentemente', 'Casi todos los partidos'],
      },
    ],
  },
  {
    key: 'tec',
    label: 'Técnica',
    emoji: '🎯',
    color: '#a78bfa',
    questions: [
      {
        q: 'Al recibir un pase fuerte o incómodo, normalmente:',
        opts: ['Se me va el balón', 'Me cuesta controlarlo', 'Lo controlo con dificultad', 'Lo controlo bien', 'Controlo y quedo listo para jugar de inmediato'],
      },
      {
        q: 'Con presión de un rival cerca, normalmente:',
        opts: ['Pierdo el balón rápido', 'Me pongo nervioso y lo suelto', 'Lo suelto rápido para no perderlo', 'Protejo y paso con criterio', 'Salgo jugando o gambeteo bajo presión'],
      },
      {
        q: '¿Qué tan preciso eres en pases cortos?',
        opts: ['Fallo muchos', 'Fallo algunos fáciles', 'Cumplo pases sencillos', 'Suelo pasar bien', 'Soy muy preciso en pase corto'],
      },
      {
        q: '¿Qué tan preciso eres en pases largos o cambios de frente?',
        opts: ['Casi no los intento', 'Los intento y fallo mucho', 'A veces salen bien', 'Suelo hacerlo bien', 'Es una de mis fortalezas'],
      },
      {
        q: 'Con el balón en los pies, conduciendo, normalmente:',
        opts: ['Me cuesta conducir', 'Solo conduzco si estoy libre', 'Conduzco aceptablemente', 'Conduzco bajo presión moderada', 'Buen dominio, control y gambeta'],
      },
    ],
  },
  {
    key: 'dis',
    label: 'Disparo',
    emoji: '🥅',
    color: '#4ade80',
    questions: [
      {
        q: 'Cuando rematas al arco, normalmente:',
        opts: ['Casi nunca le pego bien', 'Sin dirección definida', 'A veces va al arco', 'Con dirección controlada', 'Fuerte y colocado'],
      },
      {
        q: '¿Qué tan cómodo te sientes rematando de media distancia?',
        opts: ['No remato de lejos', 'Casi nunca lo intento', 'Lo intento algunas veces', 'Me siento cómodo haciéndolo', 'Es una de mis fortalezas'],
      },
      {
        q: 'Cuando tienes una oportunidad clara de gol, normalmente:',
        opts: ['Me bloqueo o fallo mucho', 'Me cuesta definir', 'A veces convierto', 'Suelo definir bien', 'Soy muy efectivo en el mano a mano'],
      },
      {
        q: '¿Puedes rematar con ambas piernas?',
        opts: ['Una sola pierna y con dificultad', 'Solo mi pierna dominante', 'Con la otra resuelvo lo básico', 'Ambas aceptablemente', 'Remato bien con ambas piernas'],
      },
      {
        q: 'En tiros libres, penales o remates quietos:',
        opts: ['No suelo patear', 'Poca precisión', 'A veces salen bien', 'Buena pegada', 'Soy de los mejores pateando'],
      },
    ],
  },
]

const POSICIONES = ['Arquero', 'Defensa', 'Lateral', 'Volante', 'Extremo', 'Delantero']
const PIERNAS = ['Derecha', 'Izquierda', 'Ambas']

// ── FIFA Card Component ────────────────────────────────────────────────────────

function getTierStyle(tier: string): { bg: string; text: string; label: string } {
  switch (tier) {
    case 'leyenda': return { bg: 'linear-gradient(145deg, #1a0533, #4c1d95, #7c3aed, #a855f7)', text: '#f3e8ff', label: 'LEYENDA MBA' }
    case 'crack':   return { bg: 'linear-gradient(145deg, #431407, #9a3412, #ea580c, #fb923c)', text: '#fff7ed', label: 'CRACK MBA' }
    case 'oro':     return { bg: 'linear-gradient(145deg, #713f12, #a16207, #ca8a04, #eab308, #fde047)', text: '#1c1917', label: 'ORO' }
    case 'plata':   return { bg: 'linear-gradient(145deg, #1e293b, #334155, #64748b, #94a3b8)', text: '#f1f5f9', label: 'PLATA' }
    case 'bronce_alto': return { bg: 'linear-gradient(145deg, #292524, #57534e, #a8a29e, #d6d3d1)', text: '#1c1917', label: 'BRONCE' }
    default:        return { bg: 'linear-gradient(145deg, #1c1917, #44403c, #78716c)', text: '#e7e5e4', label: 'BRONCE' }
  }
}

interface CartaStats {
  stat_res: number; stat_fis: number; stat_def: number
  stat_ata: number; stat_tec: number; stat_dis: number
  ovr: number; tier: string; posicion_carta: string; username: string
  avatar_url?: string | null
}

export function FifaCard({ s, size = 'md' }: { s: CartaStats; size?: 'sm' | 'md' | 'lg' }) {
  const ts = getTierStyle(s.tier)
  const scale = size === 'sm' ? 0.65 : size === 'lg' ? 1.2 : 1
  const w = Math.round(280 * scale)
  const h = Math.round(400 * scale)

  const statRows = [
    [{ k: 'RES', v: s.stat_res }, { k: 'FÍS', v: s.stat_fis }],
    [{ k: 'DEF', v: s.stat_def }, { k: 'ATA', v: s.stat_ata }],
    [{ k: 'TEC', v: s.stat_tec }, { k: 'DIS', v: s.stat_dis }],
  ]

  return (
    <div style={{
      width: w, height: h,
      background: ts.bg,
      borderRadius: Math.round(16 * scale),
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      flexShrink: 0,
    }}>
      {/* Diagonal shine overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%, rgba(0,0,0,0.1) 100%)',
        pointerEvents: 'none',
      }} />

      {/* OVR + position top-left */}
      <div style={{ position: 'absolute', top: Math.round(18 * scale), left: Math.round(20 * scale) }}>
        <div className="display" style={{ fontSize: Math.round(42 * scale), color: ts.text, lineHeight: 1, opacity: 0.95 }}>
          {s.ovr}
        </div>
        <div className="mono" style={{ fontSize: Math.round(11 * scale), color: ts.text, opacity: 0.8, letterSpacing: '0.1em', marginTop: 2 }}>
          {s.posicion_carta?.toUpperCase() || 'JUG'}
        </div>
        <div className="mono" style={{ fontSize: Math.round(9 * scale), color: ts.text, opacity: 0.6, letterSpacing: '0.05em', marginTop: 4 }}>
          {ts.label}
        </div>
      </div>

      {/* Avatar area */}
      <div style={{
        position: 'absolute',
        top: Math.round(14 * scale),
        left: '50%', transform: 'translateX(-50%)',
        width: Math.round(120 * scale), height: Math.round(140 * scale),
        overflow: 'hidden',
      }}>
        {s.avatar_url ? (
          <img src={s.avatar_url} alt={s.username} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="display" style={{ fontSize: Math.round(64 * scale), color: ts.text, opacity: 0.4, lineHeight: 1 }}>
              {s.username?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
        )}
      </div>

      {/* Bottom section — name + stats */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(4px)',
        padding: `${Math.round(10 * scale)}px ${Math.round(16 * scale)}px ${Math.round(14 * scale)}px`,
      }}>
        {/* Name */}
        <div className="display" style={{
          fontSize: Math.round(20 * scale),
          color: ts.text,
          textAlign: 'center',
          letterSpacing: '0.08em',
          marginBottom: Math.round(8 * scale),
          textShadow: '0 1px 3px rgba(0,0,0,0.5)',
        }}>
          {s.username.toUpperCase()}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: `${ts.text}40`, margin: `${Math.round(6 * scale)}px 0` }} />

        {/* Stats grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(3 * scale) }}>
          {statRows.map((row, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: Math.round(4 * scale) }}>
              {/* Left stat */}
              <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(4 * scale), justifyContent: 'flex-end' }}>
                <span className="display" style={{ fontSize: Math.round(14 * scale), color: ts.text }}>{row[0].v}</span>
                <span className="mono" style={{ fontSize: Math.round(9 * scale), color: ts.text, opacity: 0.7, letterSpacing: '0.05em' }}>{row[0].k}</span>
              </div>
              {/* Divider */}
              <div style={{ width: 1, height: Math.round(12 * scale), background: `${ts.text}40` }} />
              {/* Right stat */}
              <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(4 * scale) }}>
                <span className="display" style={{ fontSize: Math.round(14 * scale), color: ts.text }}>{row[1].v}</span>
                <span className="mono" style={{ fontSize: Math.round(9 * scale), color: ts.text, opacity: 0.7, letterSpacing: '0.05em' }}>{row[1].k}</span>
              </div>
            </div>
          ))}
        </div>

        {/* MBA label */}
        <div className="mono" style={{ textAlign: 'center', fontSize: Math.round(8 * scale), color: ts.text, opacity: 0.5, letterSpacing: '0.15em', marginTop: Math.round(6 * scale) }}>
          MBA FÚTBOL CLUB
        </div>
      </div>
    </div>
  )
}

// ── Main Form Page ─────────────────────────────────────────────────────────────

export default function MiCartaPage() {
  const supabase = createClient()
  const [step, setStep] = useState(0)  // 0 = intro/basic info, 1–6 = sections, 7 = review+submit
  const [posicion, setPosicion] = useState('')
  const [pierna, setPierna] = useState('')
  const [answers, setAnswers] = useState<Record<string, number[]>>({
    res: [], fis: [], def: [], ata: [], tec: [], dis: [],
  })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [existingCarta, setExistingCarta] = useState<Record<string, unknown> | null>(null)
  const [submitResult, setSubmitResult] = useState<{ ovr: number; tier: string } | null>(null)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/login'; return }

      const { data: prof } = await supabase.from('profiles').select('username, avatar_url, aprobado').eq('id', user.id).single()
      if (!(prof as { aprobado?: boolean })?.aprobado) { window.location.href = '/'; return }
      setUsername((prof as { username?: string })?.username ?? '')
      setAvatarUrl((prof as { avatar_url?: string | null })?.avatar_url ?? null)

      const res = await fetch('/api/carta')
      if (res.ok) {
        const data = await res.json()
        if (data.carta) setExistingCarta(data.carta)
      }
      setLoading(false)
    }
    init()
  }, [])

  const setAnswer = (sectionKey: string, qIdx: number, val: number) => {
    setAnswers(prev => {
      const arr = [...(prev[sectionKey] ?? [])]
      arr[qIdx] = val
      return { ...prev, [sectionKey]: arr }
    })
  }

  const sectionComplete = useCallback((key: string) => {
    const arr = answers[key] ?? []
    return arr.length === 5 && arr.every(v => v >= 1 && v <= 5)
  }, [answers])

  const currentSectionKey = step >= 1 && step <= 6 ? SECTIONS[step - 1].key : null
  const currentSection = step >= 1 && step <= 6 ? SECTIONS[step - 1] : null
  const totalSteps = 8  // 0=intro, 1-6=sections, 7=review

  const calcStatPreview = (key: string): number => {
    const arr = answers[key] ?? []
    if (arr.length !== 5 || arr.some(v => !v)) return 0
    return Math.round(45 + arr.reduce((s, v) => s + v, 0) * 2)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/carta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, posicion_carta: posicion, pierna }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Error al enviar'); setSubmitting(false); return }
      setSubmitResult({ ovr: data.ovr, tier: data.tier })
    } catch {
      setError('Error de conexión')
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>CARGANDO...</div>
      </div>
    )
  }

  // Success screen
  if (submitResult) {
    const ts = getTierStyle(submitResult.tier)
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 className="display" style={{ fontSize: 32, letterSpacing: '0.05em', marginBottom: 8 }}>¡Evaluación enviada!</h2>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Tu carta está pendiente de aprobación por el admin.<br />
            Aparecerá en tu perfil una vez aprobada.
          </p>
        </div>
        <div style={{ background: ts.bg, padding: '12px 24px', borderRadius: 8, textAlign: 'center' }}>
          <div className="display" style={{ fontSize: 48, color: ts.text }}>{submitResult.ovr}</div>
          <div className="mono" style={{ fontSize: 11, color: ts.text, opacity: 0.8, letterSpacing: '0.1em' }}>OVR — {ts.label}</div>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
          El admin revisará tus respuestas y puede ajustar los valores antes de aprobar.
        </div>
        <Link href="/perfil" className="btn btn-primary" style={{ padding: '12px 32px' }}>Ir a mi perfil</Link>
      </div>
    )
  }

  // Already approved card
  if (existingCarta?.aprobado) {
    const ec = existingCarta as Record<string, unknown>
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 8 }}>TU CARTA FIFA</div>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>Aprobada · Para actualizar contacta al admin</p>
        </div>
        <FifaCard size="lg" s={{
          stat_res: ec.stat_res as number, stat_fis: ec.stat_fis as number,
          stat_def: ec.stat_def as number, stat_ata: ec.stat_ata as number,
          stat_tec: ec.stat_tec as number, stat_dis: ec.stat_dis as number,
          ovr: ec.ovr as number, tier: ec.tier as string,
          posicion_carta: ec.posicion_carta as string,
          username, avatar_url: avatarUrl,
        }} />
        <Link href="/perfil" className="btn btn-ghost" style={{ padding: '10px 24px' }}>← Volver al perfil</Link>
      </div>
    )
  }

  // Pending review
  if (existingCarta && !existingCarta.aprobado && !existingCarta.rechazado) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
          <h2 className="display" style={{ fontSize: 28, letterSpacing: '0.05em', marginBottom: 12 }}>Carta en revisión</h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            Enviaste tu evaluación. El admin la está revisando.<br />
            Aparecerá en tu perfil una vez aprobada.
          </p>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 16 }}>
            OVR calculado: <strong style={{ color: 'var(--amber)' }}>{existingCarta.ovr as number}</strong>
          </div>
        </div>
        <Link href="/perfil" className="btn btn-ghost" style={{ padding: '10px 24px' }}>← Volver al perfil</Link>
      </div>
    )
  }

  // Progress bar
  const progress = step === 0 ? 5 : step <= 6 ? Math.round((step / 7) * 90) : 95

  return (
    <div style={{ minHeight: '100vh', maxWidth: 560, margin: '0 auto', padding: '0 20px 80px' }}>
      {/* Header */}
      <div style={{ padding: '24px 0 16px', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Link href="/perfil" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← Perfil</Link>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
            {step === 0 ? 'DATOS BÁSICOS' : step <= 6 ? `${step}/6 — ${SECTIONS[step - 1].label.toUpperCase()}` : 'RESUMEN'}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{progress}%</div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
          <div style={{ height: '100%', background: 'var(--green)', borderRadius: 2, width: `${progress}%`, transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* ── STEP 0: Intro + basic info ── */}
      {step === 0 && (
        <div className="fade-in" style={{ paddingTop: 40 }}>
          <div style={{ marginBottom: 32 }}>
            <div className="display" style={{ fontSize: 36, letterSpacing: '0.05em', marginBottom: 8 }}>
              ⚽ TU CARTA <span style={{ color: 'var(--green)' }}>FIFA</span>
            </div>
            <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              Responde con honestidad basándote en tu rendimiento real en los partidos de MBA.
              No te asignes números — solo selecciona la opción que mejor te describe.
            </p>
            {(existingCarta?.rechazado as boolean | undefined) && (
              <div style={{ marginTop: 16, background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 4, padding: '12px 16px' }}>
                <div className="mono" style={{ fontSize: 12, color: '#f87171' }}>
                  ⚠️ Tu carta anterior fue rechazada.
                  {existingCarta?.notas_admin ? ` Nota del admin: "${existingCarta.notas_admin as string}"` : ''}
                  {' '}Puedes volver a enviar.
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 10 }}>
                POSICIÓN EN EL CAMPO
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {POSICIONES.map(p => (
                  <button key={p} onClick={() => setPosicion(p)}
                    className="btn" style={{
                      fontSize: 12, padding: '8px 16px',
                      background: posicion === p ? 'var(--green)' : 'var(--bg-card)',
                      color: posicion === p ? '#000' : 'var(--text-muted)',
                      border: `1px solid ${posicion === p ? 'var(--green)' : 'var(--border)'}`,
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 10 }}>
                PIERNA DOMINANTE
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {PIERNAS.map(p => (
                  <button key={p} onClick={() => setPierna(p)}
                    className="btn" style={{
                      fontSize: 12, padding: '8px 20px',
                      background: pierna === p ? 'var(--green)' : 'var(--bg-card)',
                      color: pierna === p ? '#000' : 'var(--text-muted)',
                      border: `1px solid ${pierna === p ? 'var(--green)' : 'var(--border)'}`,
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sections overview */}
          <div style={{ marginTop: 40, marginBottom: 32 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 12 }}>
              6 SECCIONES · 5 PREGUNTAS CADA UNA
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {SECTIONS.map(s => (
                <div key={s.key} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{s.emoji}</span>
                  <div>
                    <div className="mono" style={{ fontSize: 11, color: s.color, letterSpacing: '0.05em' }}>{s.label.toUpperCase()}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>5 preguntas</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep(1)}
            disabled={!posicion || !pierna}
            className="btn btn-primary"
            style={{ width: '100%', padding: '16px', fontSize: 14 }}
          >
            Comenzar evaluación →
          </button>
          {(!posicion || !pierna) && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', marginTop: 8 }}>
              Selecciona posición y pierna para continuar
            </div>
          )}
        </div>
      )}

      {/* ── STEPS 1–6: Section questions ── */}
      {step >= 1 && step <= 6 && currentSection && (
        <div className="fade-in" style={{ paddingTop: 32 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 32 }}>{currentSection.emoji}</span>
              <div>
                <div className="display" style={{ fontSize: 28, letterSpacing: '0.05em', color: currentSection.color }}>
                  {currentSection.label.toUpperCase()}
                </div>
              </div>
            </div>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Selecciona la opción que mejor describe tu rendimiento real en los partidos de MBA.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {currentSection.questions.map((q, qi) => {
              const selected = answers[currentSection.key]?.[qi]
              return (
                <div key={qi}>
                  <div style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 14, fontWeight: 500 }}>
                    <span className="mono" style={{ color: currentSection.color, marginRight: 8, fontSize: 12 }}>{qi + 1}.</span>
                    {q.q}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {q.opts.map((opt, oi) => {
                      const val = oi + 1
                      const isSelected = selected === val
                      return (
                        <button
                          key={oi}
                          onClick={() => setAnswer(currentSection.key, qi, val)}
                          style={{
                            textAlign: 'left',
                            padding: '12px 16px',
                            background: isSelected ? `${currentSection.color}20` : 'var(--bg-card)',
                            border: `1px solid ${isSelected ? currentSection.color : 'var(--border)'}`,
                            borderRadius: 6,
                            color: isSelected ? currentSection.color : 'var(--text-muted)',
                            fontFamily: 'DM Mono, monospace',
                            fontSize: 13,
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 12,
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            border: `2px solid ${isSelected ? currentSection.color : 'var(--border)'}`,
                            background: isSelected ? currentSection.color : 'transparent',
                            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSelected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#000' }} />}
                          </div>
                          <span>{opt}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Nav buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 40 }}>
            <button onClick={() => setStep(step - 1)} className="btn btn-ghost" style={{ padding: '12px 24px', flex: '0 0 auto' }}>
              ← Atrás
            </button>
            <button
              onClick={() => setStep(step + 1)}
              disabled={!sectionComplete(currentSection.key)}
              className="btn btn-primary"
              style={{ flex: 1, padding: '12px' }}
            >
              {step === 6 ? 'Ver resumen →' : `Siguiente: ${SECTIONS[step].label} →`}
            </button>
          </div>
          {!sectionComplete(currentSection.key) && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', marginTop: 8 }}>
              Responde todas las preguntas para continuar
            </div>
          )}
        </div>
      )}

      {/* ── STEP 7: Review + submit ── */}
      {step === 7 && (
        <div className="fade-in" style={{ paddingTop: 32 }}>
          <div className="display" style={{ fontSize: 28, letterSpacing: '0.05em', marginBottom: 8 }}>RESUMEN</div>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 32, lineHeight: 1.6 }}>
            Estadísticas calculadas basadas en tus respuestas. El admin las revisará antes de publicar tu carta.
          </p>

          {/* Stats preview */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 32 }}>
            {SECTIONS.map(s => {
              const val = calcStatPreview(s.key)
              return (
                <div key={s.key} className="card" style={{ padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{s.emoji}</div>
                  <div className="display" style={{ fontSize: 36, color: s.color, lineHeight: 1 }}>{val || '—'}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginTop: 4 }}>{s.label.toUpperCase()}</div>
                </div>
              )
            })}
          </div>

          {/* OVR estimate */}
          {SECTIONS.every(s => sectionComplete(s.key)) && (() => {
            const ovrEst = Math.round(SECTIONS.reduce((sum, s) => sum + calcStatPreview(s.key), 0) / SECTIONS.length)
            const ts = getTierStyle(calcTier(ovrEst))
            return (
              <div style={{ background: ts.bg, borderRadius: 8, padding: '20px', textAlign: 'center', marginBottom: 32 }}>
                <div className="mono" style={{ fontSize: 11, color: ts.text, opacity: 0.7, letterSpacing: '0.1em', marginBottom: 4 }}>MEDIA GENERAL</div>
                <div className="display" style={{ fontSize: 56, color: ts.text, lineHeight: 1 }}>{ovrEst}</div>
                <div className="mono" style={{ fontSize: 12, color: ts.text, opacity: 0.8, marginTop: 4, letterSpacing: '0.05em' }}>{ts.label}</div>
              </div>
            )
          })()}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
            <div className="card" style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Posición</span>
              <span className="mono" style={{ fontSize: 12 }}>{posicion}</span>
            </div>
            <div className="card" style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pierna dominante</span>
              <span className="mono" style={{ fontSize: 12 }}>{pierna}</span>
            </div>
          </div>

          {error && (
            <div className="mono" style={{ color: 'var(--red)', fontSize: 12, marginBottom: 16, textAlign: 'center' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => setStep(6)} className="btn btn-ghost" style={{ padding: '12px 24px', flex: '0 0 auto' }}>
              ← Revisar
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn btn-primary"
              style={{ flex: 1, padding: '14px', fontSize: 14 }}
            >
              {submitting ? 'Enviando...' : '✓ Enviar evaluación'}
            </button>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
            El admin revisará tus respuestas antes de publicar la carta.
          </div>
        </div>
      )}
    </div>
  )
}

function calcTier(ovr: number): string {
  if (ovr >= 88) return 'leyenda'
  if (ovr >= 81) return 'crack'
  if (ovr >= 74) return 'oro'
  if (ovr >= 67) return 'plata'
  if (ovr >= 60) return 'bronce_alto'
  return 'bronce_bajo'
}

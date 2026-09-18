// ── Resumen de asistencia de un jugador ──────────────────────────────────────
// Para la ficha del panel. No interesa el historial partido por partido — eso
// ya pasó y el número final lo resume. Interesa dónde está parado hoy: si viene
// seguido, si desapareció, y hace cuánto.
//
// "Partidos posibles" cuenta desde que entró al club, no desde el primer partido
// que existe: a alguien que llegó el mes pasado no se le puede reprochar el año.

export interface PartidoAsistencia {
  id: string
  fecha: string
}

export interface ResumenAsistencia {
  jugados: number
  posibles: number
  /** 0–100, o null si todavía no ha podido jugar ninguno. */
  porcentaje: number | null
  /** Fecha del último que jugó, o null si nunca. */
  ultimo_jugado: string | null
  /** Partidos del club desde el último que jugó. 0 si jugó el más reciente. */
  partidos_desde_ultimo: number
  /** Partidos seguidos jugando, contando desde el más reciente. */
  racha_jugados: number
  /** Faltas seguidas contando desde el más reciente (la ausencia marcada no cuenta). */
  racha_faltas: number
}

const jugo = (estado: string | undefined) => estado === 'confirmado'
/** Inscribirse y quedar en espera es presencia: no entró por cupo, no por él. */
const sePresento = (estado: string | undefined) => estado === 'confirmado' || estado === 'espera'

/**
 * `partidos` va del más reciente al más antiguo y solo trae los que se jugaron.
 */
export function resumenAsistencia(opts: {
  partidos: PartidoAsistencia[]
  estadoPorPartido: Map<string, string>
  ausenteEnFecha: (fecha: string) => boolean
  desdeFecha: string
}): ResumenAsistencia {
  // Solo los que existieron para él.
  const suyos = opts.partidos.filter(p => p.fecha >= opts.desdeFecha)

  let jugados = 0
  let ultimo: string | null = null
  let desdeUltimo = 0
  let vistoUltimo = false

  for (const p of suyos) {
    const estado = opts.estadoPorPartido.get(p.id)
    if (jugo(estado)) {
      jugados++
      if (!vistoUltimo) { ultimo = p.fecha; vistoUltimo = true }
    } else if (!vistoUltimo) {
      desdeUltimo++
    }
  }

  // Rachas: las dos cuentan desde el más reciente, y son excluyentes — si jugó
  // el último, la de faltas es 0, y al revés.
  let rachaJugados = 0
  for (const p of suyos) {
    if (!jugo(opts.estadoPorPartido.get(p.id))) break
    rachaJugados++
  }

  let rachaFaltas = 0
  for (const p of suyos) {
    const estado = opts.estadoPorPartido.get(p.id)
    if (sePresento(estado)) break
    if (opts.ausenteEnFecha(p.fecha)) break
    rachaFaltas++
  }

  return {
    jugados,
    posibles: suyos.length,
    porcentaje: suyos.length ? Math.round((jugados / suyos.length) * 100) : null,
    ultimo_jugado: ultimo,
    partidos_desde_ultimo: ultimo ? desdeUltimo : suyos.length,
    racha_jugados: rachaJugados,
    racha_faltas: rachaFaltas,
  }
}

/** Días calendario entre una fecha YYYY-MM-DD y hoy (también YYYY-MM-DD). */
export function diasDesde(fecha: string, hoy: string): number {
  const a = new Date(fecha + 'T12:00:00').getTime()
  const b = new Date(hoy + 'T12:00:00').getTime()
  return Math.max(0, Math.round((b - a) / 86400000))
}

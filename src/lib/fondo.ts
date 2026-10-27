// ── Fondo MBA ────────────────────────────────────────────────────────────────
//
// La cancha cuesta 140.000. El equipo que gana paga 9.000 por cabeza y el que
// pierde 13.000: 7 × 9.000 + 7 × 13.000 = 154.000, y los 14.000 que sobran van
// al fondo. Repartido entre los 14, son 1.000 por persona y por partido.
//
// Es una cuenta TEÓRICA, y la pantalla lo dice. En la realidad el ganador
// aporta un poco más que el perdedor (pagan 63.000 por una parte de cancha de
// 55.000; los perdedores, 91.000 por 85.000), y no todos los partidos son de
// 14. El club decidió contar 1.000 parejo por persona: es simple, es justo a
// la larga, y nadie va a discutir por 143 pesos.
//
// Cuenta desde las INSCRIPCIONES confirmadas, no desde `rating_events`. Un
// partido que nadie cerró (sin admin, sin marcador) no tiene eventos de
// puntaje, pero la cancha se pagó igual: esa gente sí aportó.

export const APORTE_POR_PERSONA = 1000

export interface AporteFila {
  partido_id: string
  fecha: string          // YYYY-MM-DD
  player_id: string
  username: string
  avatar_url: string | null
}

export interface AportanteFondo {
  player_id: string
  username: string
  avatar_url: string | null
  partidos: number
  total: number
  /** Posición en el ranking. Los empatados comparten número. */
  puesto: number
  primera: string
  ultima: string
  /** Fechas en que aportó, la más reciente primero. */
  fechas: string[]
}

export interface ResumenFondo {
  total: number
  partidos: number
  aportes: number
  desde: string | null
  ranking: AportanteFondo[]
  /** Los invitados no tienen cuenta: se suman en una sola línea. */
  invitados: { aportes: number; total: number }
}

export function calcularFondo(
  filas: AporteFila[],
  invitados: { partido_id: string; fecha: string }[],
  aporte: number = APORTE_POR_PERSONA
): ResumenFondo {
  const porJugador = new Map<string, AportanteFondo & { _vistos: Set<string> }>()
  const partidos = new Set<string>()
  let desde: string | null = null

  for (const f of filas) {
    partidos.add(f.partido_id)
    if (!desde || f.fecha < desde) desde = f.fecha
    let a = porJugador.get(f.player_id)
    if (!a) {
      a = {
        player_id: f.player_id, username: f.username, avatar_url: f.avatar_url,
        partidos: 0, total: 0, puesto: 0, primera: f.fecha, ultima: f.fecha, fechas: [],
        _vistos: new Set(),
      }
      porJugador.set(f.player_id, a)
    }
    // Una inscripción por jugador y partido, pero por si acaso llega repetida
    // (dos páginas que se pisan) no se cuenta dos veces.
    if (a._vistos.has(f.partido_id)) continue
    a._vistos.add(f.partido_id)
    a.partidos++
    a.total += aporte
    a.fechas.push(f.fecha)
    if (f.fecha < a.primera) a.primera = f.fecha
    if (f.fecha > a.ultima) a.ultima = f.fecha
  }

  for (const i of invitados) {
    partidos.add(i.partido_id)
    if (!desde || i.fecha < desde) desde = i.fecha
  }

  // El que más ha puesto, primero. A igual plata, el que aportó más reciente
  // (sigue activo), y después por nombre para que el orden no baile.
  const ranking = [...porJugador.values()]
    .map(({ _vistos, ...a }) => ({ ...a, fechas: [...a.fechas].sort().reverse() }))
    .sort((x, y) => y.total - x.total || y.ultima.localeCompare(x.ultima) || x.username.localeCompare(y.username))

  // Puesto con empates: 1, 2, 2, 4. Dos personas con la misma plata puesta
  // están igual de arriba, y el orden por fecha es solo para leer la lista.
  let puesto = 0
  ranking.forEach((a, i) => {
    if (i === 0 || a.total !== ranking[i - 1].total) puesto = i + 1
    a.puesto = puesto
  })

  const aportesJugadores = ranking.reduce((s, a) => s + a.partidos, 0)
  const invitadosTotal = invitados.length * aporte

  return {
    total: aportesJugadores * aporte + invitadosTotal,
    partidos: partidos.size,
    aportes: aportesJugadores + invitados.length,
    desde,
    ranking,
    invitados: { aportes: invitados.length, total: invitadosTotal },
  }
}

/** "$ 1.234.000" — armado a mano, igual en servidor y navegador. */
export function formatoPesos(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '−' : ''}$ ${s}`
}

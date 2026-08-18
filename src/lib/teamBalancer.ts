export interface JugadorEquipo {
  id: string
  username: string
  avatar_url: string | null
  posicion: string
  posiciones?: string[]
  habilidad: number
  isInvitado?: boolean
}

const POSICION_EMOJI: Record<string, string> = {
  portero: '🧤',
  defensa: '🛡️',
  medio: '⚙️',
  delantero: '⚡',
  cualquiera: '🔄',
}

export function posicionEmoji(posicion: string): string {
  return POSICION_EMOJI[posicion] ?? '🔄'
}

export function calcularSkillPromedio(jugadores: JugadorEquipo[]): number {
  if (jugadores.length === 0) return 0
  return jugadores.reduce((s, j) => s + j.habilidad, 0) / jugadores.length
}

/**
 * Snake-draft balancing algorithm:
 *  Round 0: A picks #1, B picks #2
 *  Round 1: B picks #3, A picks #4
 *  Round 2: A picks #5, B picks #6 ...
 * This minimises the difference in total skill between teams.
 * After the draft we attempt one goalkeeper-balance swap.
 */
export function balancearEquipos(jugadores: JugadorEquipo[]): {
  equipoA: JugadorEquipo[]
  equipoB: JugadorEquipo[]
} {
  if (jugadores.length === 0) return { equipoA: [], equipoB: [] }

  const sorted = [...jugadores].sort((a, b) => b.habilidad - a.habilidad)
  const equipoA: JugadorEquipo[] = []
  const equipoB: JugadorEquipo[] = []

  sorted.forEach((j, i) => {
    const round = Math.floor(i / 2)
    const pick = i % 2
    if (round % 2 === 0) {
      pick === 0 ? equipoA.push(j) : equipoB.push(j)
    } else {
      pick === 0 ? equipoB.push(j) : equipoA.push(j)
    }
  })

  // Fix goalkeeper imbalance: if one team has 2+ keepers and other has 0,
  // swap the weakest keeper from the stacked side with the weakest outfield
  // player from the other side.
  const esPortero = (j: JugadorEquipo) => j.posicion === 'portero' || !!j.posiciones?.includes('portero')

  const fixKeepers = (rich: JugadorEquipo[], poor: JugadorEquipo[]) => {
    if (rich.filter(esPortero).length < 2) return
    const spare = [...rich].filter(esPortero).sort((a, b) => a.habilidad - b.habilidad)[0]
    const swap = [...poor].filter(j => !esPortero(j)).sort((a, b) => a.habilidad - b.habilidad)[0]
    if (!spare || !swap) return
    rich.splice(rich.indexOf(spare), 1, swap)
    poor.splice(poor.indexOf(swap), 1, spare)
  }

  const keepsA = equipoA.filter(esPortero).length
  const keepsB = equipoB.filter(esPortero).length
  if (keepsA === 0 && keepsB >= 2) fixKeepers(equipoB, equipoA)
  else if (keepsB === 0 && keepsA >= 2) fixKeepers(equipoA, equipoB)

  return { equipoA, equipoB }
}

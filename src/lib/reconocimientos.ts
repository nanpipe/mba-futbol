import type { createAdminClient } from '@/lib/supabase/admin'

// ── Quórum de reconocimientos ────────────────────────────────────────────────
// Un reconocimiento solo se asigna si la votación tuvo respaldo suficiente.
// Antes bastaba 1 voto: el jugador con más votos en la categoría ganaba, aunque
// fuera el único que votó esa categoría.
//
// Regla (configurable por club en app_settings):
//
//   respaldo = votos_del_ganador >= min_votos  OR  votantes_del_partido >= min_votantes
//   asignado = respaldo AND votos_del_ganador >= min_ganador
//
// El OR es el quórum que pidió el club: una categoría con hartos votos vale por
// sí sola, y si votó casi todo el partido la muestra ya es representativa.
// `min_ganador` es el piso que el OR por sí solo no garantiza — con 8 votantes
// repartidos en 8 personas el ganador tendría 1 voto y el OR igual lo asignaría.

export const RECO_CONFIG = [
  {
    key: 'reco_min_votos',
    label: 'Votos mínimos en la categoría',
    desc: 'Votos que necesita el ganador para llevarse el reconocimiento por sí solo',
    def: '5', min: 1, max: 30,
  },
  {
    key: 'reco_min_votantes',
    label: 'Votantes mínimos del partido',
    desc: 'Si vota al menos esta cantidad de jugadores, la votación vale aunque la categoría tenga pocos votos',
    def: '8', min: 1, max: 40,
  },
  {
    key: 'reco_min_ganador',
    label: 'Piso de votos del ganador',
    desc: 'Nadie gana con menos votos que esto, sin importar cuántos hayan votado',
    def: '2', min: 1, max: 10,
  },
] as const

export const RECO_CONFIG_KEYS = RECO_CONFIG.map(c => c.key) as readonly string[]

export type RecoConfigKey = typeof RECO_CONFIG[number]['key']

export interface Quorum {
  minVotos: number
  minVotantes: number
  minGanador: number
}

/** Lee un umbral numérico de reconocimientos con su default. */
export function recoNumber(settings: Record<string, unknown>, key: RecoConfigKey): number {
  const cfg = RECO_CONFIG.find(c => c.key === key)!
  const n = parseInt(String(settings[key] ?? cfg.def), 10)
  if (isNaN(n)) return parseInt(cfg.def, 10)
  return Math.max(cfg.min, Math.min(cfg.max, n))
}

/** Arma el quórum a partir de un mapa de settings ya leído. */
export function quorumDeSettings(settings: Record<string, unknown>): Quorum {
  return {
    minVotos: recoNumber(settings, 'reco_min_votos'),
    minVotantes: recoNumber(settings, 'reco_min_votantes'),
    minGanador: recoNumber(settings, 'reco_min_ganador'),
  }
}

/** Lee el quórum configurado del club desde app_settings. */
export async function getQuorum(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string
): Promise<Quorum> {
  const { data } = await admin
    .from('app_settings')
    .select('key, value')
    .eq('club_id', clubId)
    .in('key', RECO_CONFIG_KEYS as string[])

  const settings: Record<string, unknown> = {}
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    settings[row.key] = row.value
  }
  return quorumDeSettings(settings)
}

export interface Ganadores {
  /** Todos los empatados en el tope. Vacío si nadie tiene votos. */
  ids: string[]
  /** Votos que tiene cada uno de los del tope. */
  votos: number
}

/**
 * Quién va arriba en una categoría. Devuelve TODOS los empatados en el tope —
 * antes un `reduce` se quedaba con el primero que devolviera el objeto, así que
 * un empate lo definía el orden de iteración y un re-conteo podía cambiar de
 * ganador sin que cambiara un solo voto.
 */
export function topDeCategoria(catVotes: Record<string, number>): Ganadores {
  let max = 0
  for (const n of Object.values(catVotes)) if (n > max) max = n
  if (max === 0) return { ids: [], votos: 0 }
  const ids = Object.keys(catVotes).filter(id => catVotes[id] === max).sort()
  return { ids, votos: max }
}

export type MotivoSinAsignar = 'sin_votos' | 'pocos_votos'

export interface DecisionCategoria {
  ids: string[]
  votos: number
  asignado: boolean
  motivo: MotivoSinAsignar | null
  empate: boolean
}

/** Aplica el quórum al tope de una categoría. */
export function decidirCategoria(
  catVotes: Record<string, number>,
  votantes: number,
  q: Quorum
): DecisionCategoria {
  const { ids, votos } = topDeCategoria(catVotes)
  if (ids.length === 0) {
    return { ids: [], votos: 0, asignado: false, motivo: 'sin_votos', empate: false }
  }
  const respaldo = votos >= q.minVotos || votantes >= q.minVotantes
  const asignado = respaldo && votos >= q.minGanador
  return {
    ids,
    votos,
    asignado,
    motivo: asignado ? null : 'pocos_votos',
    empate: ids.length > 1,
  }
}

/** Texto para la UI cuando una categoría se queda sin dueño. */
export function explicarSinAsignar(d: DecisionCategoria, votantes: number, q: Quorum): string {
  if (d.motivo === 'sin_votos') return 'Nadie recibió votos'
  if (d.votos < q.minGanador) {
    return `Solo ${d.votos} voto${d.votos !== 1 ? 's' : ''} — se necesitan ${q.minGanador} como mínimo`
  }
  return `${d.votos} voto${d.votos !== 1 ? 's' : ''} y ${votantes} votante${votantes !== 1 ? 's' : ''} — se necesitan ${q.minVotos} votos o ${q.minVotantes} votantes`
}

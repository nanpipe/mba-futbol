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

// ── Pulgares ─────────────────────────────────────────────────────────────────
// Los 👍/👎 se guardaban desde junio y no los leía nadie: la pantalla de
// evaluación prometía que movían el rating y no movían nada. Ahora sí, con la
// misma idea de respaldo que los reconocimientos — un pulgar suelto no mueve a
// nadie, hacen falta varios del mismo lado.
//
// Suben y bajan por separado: 4 👍 y 3 👎 en el mismo partido son un escalón
// arriba y uno abajo, no "uno neto". Cada lado se cuenta como lo vio la gente.

export const THUMBS_CONFIG = [
  {
    key: 'reco_thumbs_paso',
    label: 'Pulgares por escalón',
    desc: 'Cuántos 👍 (o 👎) del mismo partido mueven el rating un escalón. Acumulan: con paso 3, seis 👍 son dos escalones',
    def: '3', min: 1, max: 20,
  },
] as const

// ── Castigo por no votar ─────────────────────────────────────────────────────
// Jugaste el partido y no evaluaste a nadie: −STEP. Las votaciones solo sirven
// si vota la gente — un partido con 4 votos de 14 no reparte nada (no llega al
// quórum) y deja los reconocimientos vacíos para todos.
//
// Cuenta como votar cualquier evaluación enviada: votos por categoría,
// abstenciones ("No aplica") y pulgares. Lo que se castiga es no abrir la
// pantalla, no el contenido de lo que votaste.
export const CASTIGO_NO_VOTAR_KEY = 'reco_castigo_no_votar'
/** YYYY-MM-DD. Solo se castiga a partir de esta fecha de partido. Vacío = nunca. */
export const CASTIGO_DESDE_KEY = 'reco_castigo_no_votar_desde'

export const RECO_CONFIG_KEYS = [
  ...RECO_CONFIG.map(c => c.key),
  ...THUMBS_CONFIG.map(c => c.key),
  CASTIGO_NO_VOTAR_KEY,
  CASTIGO_DESDE_KEY,
] as readonly string[]

export interface CastigoNoVotar {
  activo: boolean
  /** null = sin fecha configurada, y entonces no se castiga nada. */
  desde: string | null
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Cómo está configurado el castigo por no votar.
 *
 * La fecha NO tiene default a propósito. Sin ella no se castiga a nadie, así que
 * la regla no puede volverse retroactiva por accidente: el club decide desde
 * cuándo cuenta, y los partidos anteriores quedan como lo que fueron, un período
 * en el que nadie sabía que esto existía.
 */
export function castigoNoVotarDeSettings(settings: Record<string, unknown>): CastigoNoVotar {
  const v = settings[CASTIGO_NO_VOTAR_KEY]
  const activo = !(v === false || v === 'false')
  const raw = settings[CASTIGO_DESDE_KEY]
  const desde = typeof raw === 'string' && FECHA_RE.test(raw) ? raw : null
  return { activo, desde }
}

/** ¿Se castiga a quien no votó en un partido de esta fecha? */
export function castigaEnFecha(cfg: CastigoNoVotar, fechaPartido: string): boolean {
  return cfg.activo && cfg.desde !== null && fechaPartido >= cfg.desde
}

export type RecoConfigKey =
  | typeof RECO_CONFIG[number]['key']
  | typeof THUMBS_CONFIG[number]['key']

const TODOS_LOS_CAMPOS = [...RECO_CONFIG, ...THUMBS_CONFIG] as readonly {
  key: string; def: string; min?: number; max?: number
}[]

export interface Quorum {
  minVotos: number
  minVotantes: number
  minGanador: number
}

/** Lee un umbral numérico de la evaluación post-partido con su default. */
export function recoNumber(settings: Record<string, unknown>, key: RecoConfigKey): number {
  const cfg = TODOS_LOS_CAMPOS.find(c => c.key === key)!
  const n = parseInt(String(settings[key] ?? cfg.def), 10)
  if (isNaN(n)) return parseInt(cfg.def, 10)
  return Math.max(cfg.min ?? 1, Math.min(cfg.max ?? 99, n))
}

/** Cuántos pulgares del mismo lado mueven un escalón de rating. */
export function thumbsPasoDeSettings(settings: Record<string, unknown>): number {
  return recoNumber(settings, 'reco_thumbs_paso')
}

/**
 * Escalones que mueven los pulgares de un jugador en un partido.
 * Cada lado por separado, y solo por grupos completos: con paso 3, dos 👍 no
 * mueven nada y cuatro mueven uno.
 */
export function escalonesPorPulgares(
  likes: number,
  dislikes: number,
  paso: number
): { arriba: number; abajo: number } {
  const p = Math.max(1, paso)
  return { arriba: Math.floor(likes / p), abajo: Math.floor(dislikes / p) }
}

/** Arma el quórum a partir de un mapa de settings ya leído. */
export function quorumDeSettings(settings: Record<string, unknown>): Quorum {
  return {
    minVotos: recoNumber(settings, 'reco_min_votos'),
    minVotantes: recoNumber(settings, 'reco_min_votantes'),
    minGanador: recoNumber(settings, 'reco_min_ganador'),
  }
}

/** Lee los settings de evaluación post-partido del club desde app_settings. */
async function leerSettings(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string
): Promise<Record<string, unknown>> {
  const { data } = await admin
    .from('app_settings')
    .select('key, value')
    .eq('club_id', clubId)
    .in('key', RECO_CONFIG_KEYS as string[])

  const settings: Record<string, unknown> = {}
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    settings[row.key] = row.value
  }
  return settings
}

/** Lee el quórum configurado del club desde app_settings. */
export async function getQuorum(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string
): Promise<Quorum> {
  return quorumDeSettings(await leerSettings(admin, clubId))
}

/** Lee el paso de pulgares configurado del club desde app_settings. */
export async function getThumbsPaso(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string
): Promise<number> {
  return thumbsPasoDeSettings(await leerSettings(admin, clubId))
}

/** Cómo está configurado el castigo por no votar en este club. */
export async function getCastigoNoVotar(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string
): Promise<CastigoNoVotar> {
  return castigoNoVotarDeSettings(await leerSettings(admin, clubId))
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

/**
 * Cuándo se cierran solas las votaciones de un partido.
 *
 * El cron cierra cuando la fecha del partido queda dos días atrás, o sea en el
 * tic de las 00:00 del día D+2 (ver `api/cron/notificaciones`). En la práctica
 * se vota "hasta que se acabe el día siguiente al partido", y eso no estaba
 * escrito en ninguna parte: el admin veía el botón de cerrar y no sabía que no
 * tenía que hacer nada.
 *
 * Devuelve el último día completo para votar y el día en que el cron cierra.
 * En UTC porque `partidos.fecha` es un DATE sin zona: construirlo en local
 * correría un día según dónde esté quien mire.
 */
export function cierreAutomatico(fechaPartido: string): { ultimoDia: string; cierra: string } | null {
  if (!FECHA_RE.test(fechaPartido)) return null
  const base = new Date(`${fechaPartido}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return null
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const mas = (n: number) => new Date(base.getTime() + n * 86400000)
  return { ultimoDia: iso(mas(1)), cierra: iso(mas(2)) }
}

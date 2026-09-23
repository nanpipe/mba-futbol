// ── Historial con filtros ───────────────────────────────────────────────────
//
// De dónde salen los datos, y por qué:
//
// `rating_events` ya es una fila POR JUGADOR Y POR PARTIDO, con `motivos`
// guardando 'jugó', 'ganó', 'perdió', 'empató', 'ausente'… No hace falta armar
// una tabla de hechos: existe. Y es mejor que construir una aparte, porque es
// la MISMA fuente con la que se calculó el rating que la gente ve. Si el
// historial dijera "ganaste 28" mientras el rating se calculó sobre otra cosa,
// habría dos verdades y tarde o temprano se contradicen.
//
// Lo que NO se puede saber: quién ganó exige que haya quedado guardado en qué
// equipo jugó cada quien. En los partidos sin equipos guardados el motor no
// pudo decidir y el evento quedó solo con 'jugó'. Eso no se disimula — se
// cuenta aparte, en `sin_datos`, y el porcentaje se calcula sobre los partidos
// decididos. Un 60% diluido por partidos desconocidos sería un número falso.

export type Resultado = 'ganó' | 'perdió' | 'empató'
export type Relacion = 'con' | 'contra'

export const RESULTADOS: readonly Resultado[] = ['ganó', 'perdió', 'empató'] as const
export const RELACIONES: readonly Relacion[] = ['con', 'contra'] as const

export const esResultado = (v: unknown): v is Resultado =>
  typeof v === 'string' && (RESULTADOS as readonly string[]).includes(v)
export const esRelacion = (v: unknown): v is Relacion =>
  typeof v === 'string' && (RELACIONES as readonly string[]).includes(v)

/**
 * El resultado de un jugador en un partido, leído de los motivos del ledger.
 *
 * `motivos` es jsonb, así que llega como array ya parseado, pero se valida
 * igual: una fila vieja o a medio migrar no debe tumbar la pantalla.
 */
export function resultadoDeMotivos(motivos: unknown): Resultado | null {
  if (!Array.isArray(motivos)) return null
  for (const m of motivos) {
    if (esResultado(m)) return m
  }
  return null
}

/** ¿Este evento corresponde a alguien que efectivamente jugó? */
export function jugoSegunMotivos(motivos: unknown): boolean {
  return Array.isArray(motivos) && motivos.includes('jugó')
}

export interface Ficha {
  jugados: number
  ganados: number
  perdidos: number
  empatados: number
  /** Jugó, pero no se guardaron equipos: no se puede saber si ganó. */
  sin_datos: number
  /** Sobre los partidos DECIDIDOS, no sobre los jugados. null si no hay ninguno. */
  pct_victorias: number | null
}

export function fichaDeEventos(eventos: { motivos: unknown }[]): Ficha {
  const f: Ficha = { jugados: 0, ganados: 0, perdidos: 0, empatados: 0, sin_datos: 0, pct_victorias: null }
  for (const e of eventos) {
    if (!jugoSegunMotivos(e.motivos)) continue   // ausencias y faltas no son historial de juego
    f.jugados++
    const r = resultadoDeMotivos(e.motivos)
    if (r === 'ganó') f.ganados++
    else if (r === 'perdió') f.perdidos++
    else if (r === 'empató') f.empatados++
    else f.sin_datos++
  }
  const decididos = f.ganados + f.perdidos + f.empatados
  f.pct_victorias = decididos > 0 ? Math.round((f.ganados / decididos) * 1000) / 10 : null
  return f
}

export interface FilaEquipo {
  partido_id: string
  equipo_id: string
}

/**
 * Cruce "con / contra": en qué partidos dos jugadores estuvieron en el mismo
 * equipo y en cuáles en equipos distintos.
 *
 * Solo cuenta los partidos donde AMBOS jugaron. Si uno de los dos no estuvo,
 * el partido no es ni "con" ni "contra" — no dice nada de la pareja.
 */
export function cruzarEquipos(mios: FilaEquipo[], suyos: FilaEquipo[]): { con: string[]; contra: string[] } {
  const mio = new Map<string, string>()
  // Si por un error de datos alguien apareciera en dos equipos del mismo
  // partido, se queda el primero: inventar un desempate sería peor.
  for (const f of mios) if (!mio.has(f.partido_id)) mio.set(f.partido_id, f.equipo_id)

  const con: string[] = []
  const contra: string[] = []
  const visto = new Set<string>()
  for (const f of suyos) {
    if (visto.has(f.partido_id)) continue
    const eq = mio.get(f.partido_id)
    if (eq === undefined) continue
    visto.add(f.partido_id)
    ;(eq === f.equipo_id ? con : contra).push(f.partido_id)
  }
  return { con, contra }
}

/** Límites de la paginación. Un tope duro para que `?tam=99999` no sirva. */
export const TAM_PAGINA = 15
export const TAM_MAX = 50

// Sin eñe a propósito: un identificador con carácter no-ASCII puede quedar
// guardado en dos normalizaciones Unicode distintas (NFC/NFD) y el import
// falla con un "does not provide an export named" imposible de leer.
export function tamanoPagina(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return TAM_PAGINA
  return Math.min(Math.floor(n), TAM_MAX)
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
export const esFecha = (v: string | null): v is string => typeof v === 'string' && FECHA_RE.test(v)

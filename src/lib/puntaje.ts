// ── El cálculo del puntaje, en un solo lugar ─────────────────────────────────
//
// Esto es la aritmética pura de cuánto sube o baja alguien en un partido. No
// toca la base de datos ni sabe de Supabase, y por eso puede correr en los dos
// lados:
//
//   · el servidor la usa para escribir `rating_events` (lib/rating.ts)
//   · el navegador la usa para el simulador de /puntaje
//
// Que sea la MISMA función es el punto. Un simulador que reimplemente la
// fórmula miente el día que alguien cambie un signo en uno de los dos archivos,
// y un simulador que miente es peor que no tener simulador: la gente hace
// cuentas con él y después reclama.
//
// Los `motivos` que salen de acá se guardan en la base y se filtran con
// `motivos @> ["ganó"]` desde el historial. No se les cambia el texto sin mirar
// api/historial y lib/historial primero.

export const STEP = 0.02
// El tope decide cuántas señales de un mismo partido alcanzan a contar, porque
// el neto se recorta a ±CAP. Con 0.075 (3.75 escalones) caben ganar + un
// reconocimiento + un escalón de pulgares, que es un partidazo, y sigue sin
// haber forma de saltar medio punto en una fecha.
export const CAP_NORMAL = 0.075
// El minitorneo reparte más señales (tres equipos, más reconocimientos), así
// que su tope va al doble.
export const CAP_MINI = 0.15
export const MIN_RATING = 1.0
export const MAX_RATING = 5.0
export const BASE_RATING = 3.0

export type Resultado = 'ganó' | 'perdió' | 'empató'

/** Los umbrales del club que entran en la cuenta. */
export interface ReglasPuntaje {
  /** Cuántos 👍 (o 👎) del mismo partido valen un escalón. */
  thumbsPaso: number
  /** Faltas seguidas necesarias para que empiece a restar. */
  faltasGap: number
  /**
   * ¿Se castiga a quien jugó y no evaluó, EN ESTE partido? Ya viene resuelto:
   * junta que la regla esté activa, que el partido sea posterior a la fecha
   * desde la que aplica, y que la votación no haya llegado al quórum.
   */
  castigaNoVotar: boolean
}

/** Lo que pasó con un jugador en un partido. */
export interface SenalesPartido {
  /** Se inscribió y quedó confirmado. */
  jugo: boolean
  /** Solo si jugó y quedaron guardados los equipos. */
  resultado: Resultado | null
  /** Reconocimientos positivos ganados (MVP, goleador…). */
  recoPos: number
  /** Reconocimientos negativos ganados (desaparecido, aizaga…). */
  recoNeg: number
  likes: number
  dislikes: number
  /** Mandó su evaluación (votos, abstenciones o pulgares). */
  voto: boolean
  /** Un admin lo marcó ausente en esa fecha. Solo aplica si no jugó. */
  ausente?: boolean
  /** Faltas seguidas que trae, contando esta. Solo aplica si no jugó. */
  rachaFaltas?: number
}

/** Una línea del desglose: el motivo tal como se guarda, y cuánto movió. */
export interface LineaPuntaje {
  motivo: string
  /** Escalones de ±STEP. 0 en los motivos que solo dejan rastro. */
  escalones: number
}

export interface Calculo {
  /** Lo que se guarda en `rating_events.motivos`. */
  motivos: string[]
  lineas: LineaPuntaje[]
  /** La suma antes de recortar por el tope. */
  bruto: number
  /** Lo que realmente se aplica. */
  delta: number
  /** El tope se comió parte del bruto. */
  topado: boolean
  cap: number
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000
export const clampRating = (n: number) => Math.max(MIN_RATING, Math.min(MAX_RATING, n))
const clampDelta = (n: number, cap: number) => Math.max(-cap, Math.min(cap, n))

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

/**
 * Cuánto se mueve un jugador en un partido.
 *
 * El orden de los motivos es el orden en que se leen en la pantalla y el que
 * quedó guardado en los eventos viejos; no se reordena porque sí.
 */
export function calcularPuntaje(
  s: SenalesPartido,
  reglas: ReglasPuntaje,
  esMinitorneo: boolean
): Calculo {
  const cap = esMinitorneo ? CAP_MINI : CAP_NORMAL
  const lineas: LineaPuntaje[] = []
  let bruto = 0

  const suma = (motivo: string, escalones: number) => {
    lineas.push({ motivo, escalones })
    bruto += STEP * escalones
  }

  if (s.jugo) {
    // Jugar no suma por sí solo: queda como señal de presencia con delta 0.
    // Ver la nota sobre la deriva en lib/rating.
    suma('jugó', 0)

    if (s.resultado === 'ganó') suma('ganó', 1)
    else if (s.resultado === 'perdió') suma('perdió', -1)
    else if (s.resultado === 'empató') suma('empató', 0)

    if (s.recoPos > 0) suma(`reconocimiento+ ×${s.recoPos}`, s.recoPos)
    if (s.recoNeg > 0) suma(`reconocimiento- ×${s.recoNeg}`, -s.recoNeg)

    if (reglas.castigaNoVotar && !s.voto) suma('no votó', -1)

    const pasos = escalonesPorPulgares(s.likes, s.dislikes, reglas.thumbsPaso)
    if (pasos.arriba) suma(`👍 ${s.likes} (×${pasos.arriba})`, pasos.arriba)
    if (pasos.abajo) suma(`👎 ${s.dislikes} (×${pasos.abajo})`, -pasos.abajo)
  } else if (s.ausente) {
    // Marcado ausente por un admin: no se le cobra no haberse inscrito.
    suma('ausente', 0)
  } else {
    const racha = s.rachaFaltas ?? 0
    if (racha >= reglas.faltasGap) suma(`inactivo (${racha} faltas seguidas)`, -1)
    // Se guarda el evento con delta 0: queda el rastro de que faltó y de
    // cuánto le falta para que empiece a costar.
    else suma(`no jugó (${racha}/${reglas.faltasGap})`, 0)
  }

  const delta = round3(clampDelta(bruto, cap))
  return {
    motivos: lineas.map(l => l.motivo),
    lineas,
    bruto: round3(bruto),
    delta,
    topado: Math.abs(round3(bruto)) > cap,
    cap,
  }
}

// ── Texto para la pantalla ───────────────────────────────────────────────────
// Los motivos se guardan en un formato corto y estable ("reconocimiento+ ×2"),
// bueno para filtrar y malo para leer. Esto los traduce para mostrarlos sin
// tocar lo que hay en la base.

export function explicarMotivo(motivo: string): string {
  if (motivo === 'jugó') return 'Jugó'
  if (motivo === 'ganó') return 'Ganó'
  if (motivo === 'perdió') return 'Perdió'
  if (motivo === 'empató') return 'Empató'
  if (motivo === 'ausente') return 'Ausente (no se le cobra)'
  if (motivo === 'no votó') return 'No evaluó a nadie'

  const reco = /^reconocimiento([+-]) ×(\d+)$/.exec(motivo)
  if (reco) {
    const n = Number(reco[2])
    const tipo = reco[1] === '+' ? 'Reconocimiento' : 'Reconocimiento negativo'
    return n > 1 ? `${tipo} ×${n}` : tipo
  }

  const pulgar = /^(👍|👎) (\d+) \(×(\d+)\)$/.exec(pulgarNormalizado(motivo))
  if (pulgar) return `${pulgar[1]} ${pulgar[2]} pulgares`

  const inactivo = /^inactivo \((\d+) faltas seguidas\)$/.exec(motivo)
  if (inactivo) return `Inactivo — ${inactivo[1]} faltas seguidas`

  const noJugo = /^no jugó \((\d+)\/(\d+)\)$/.exec(motivo)
  if (noJugo) return `No jugó — ${noJugo[1]} de ${noJugo[2]} faltas seguidas`

  return motivo
}

// Los emojis de pulgar viajan a veces con selector de variación (U+FE0F) según
// de dónde salió el texto, y entonces la comparación directa falla.
const pulgarNormalizado = (s: string) => s.replace(/️/g, '')

/**
 * "+0.04" / "−0.02" / "0.00". El menos es el signo tipográfico, no un guion.
 *
 * Dos decimales, como el resto del puntaje (formatRating), salvo cuando el
 * tercero no es cero. Eso pasa solo cuando el tope recortó el partido: el tope
 * es 0.075 y `(0.075).toFixed(2)` da "0.07", así que la tarjeta mostraba +0.07
 * dos renglones arriba de un texto que decía "el tope es ±0.075". El único caso
 * donde el decimal de más no es ruido es justamente ese.
 */
export function formatDelta(delta: number): string {
  const n = round3(delta)
  if (n === 0) return '0.00'
  const abs = Math.abs(n)
  const cerrado = Math.round(abs * 1000) % 10 === 0
  return `${n > 0 ? '+' : '−'}${cerrado ? abs.toFixed(2) : abs.toFixed(3)}`
}

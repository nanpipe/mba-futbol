import type { createAdminClient } from '@/lib/supabase/admin'
import { applyMatchRatings } from '@/lib/rating'

type Admin = ReturnType<typeof createAdminClient>

const BASE_RATING = 3.0

/** Partidos por llamada. Cada uno son ~10 consultas; de a 12 no se acerca al
 *  timeout de la función ni con el historial completo. */
export const RECALC_LOTE = 12

export interface RatingSnapshot {
  username: string
  rating: number
}

export interface ResultadoRecalculo {
  reiniciado: boolean
  partidos_procesados: number
  partidos_saltados: { fecha: string; razon: string }[]
  /** Fecha desde la que sigue el próximo lote. null = terminó. */
  siguiente_fecha: string | null
  /** Solo en la llamada que reinicia: los ratings de antes, para el diff final. */
  antes?: RatingSnapshot[]
  /** Solo en la última llamada: los ratings finales. */
  despues?: RatingSnapshot[]
  /** Solo en la llamada que reinicia: quién queda en la base por no estar activo. */
  reseteados_a_base?: string[]
}

/**
 * Reconstruye `rating_events` y `profiles.habilidad` replayando cada partido en
 * orden cronológico con el motor de rating actual.
 *
 * Por qué replay y no SQL: el cálculo depende de badges, pulgares, resultado,
 * equipos, inscripciones, ausencias, y de tres settings del club (signo de cada
 * badge, paso de pulgares, gap de faltas). Reescribir eso en SQL sería una
 * segunda implementación de `applyMatchRatings`, y las dos se separarían en el
 * primer cambio de reglas. Esto corre exactamente el mismo código que al cerrar
 * un partido.
 *
 * Va por lotes y es reanudable porque el historial completo son cientos de
 * consultas seriadas y la función se puede cortar por tiempo. La reanudación es
 * correcta sin trucos: `applyMatchRatings` corta con 'ya_aplicado' si el partido
 * ya tiene eventos, así que seguir desde `siguiente_fecha` continúa justo donde
 * quedó, y el acumulado sigue en orden.
 *
 * Es seguro re-correrlo desde el principio: el ledger es función pura de los
 * datos. Si algo falla a medias, reiniciar deja todo consistente.
 *
 * Consecuencia que hay que conocer: `applyMatchRatings` solo califica a quien
 * está aprobado y no baneado HOY, y no hay registro histórico de esos campos.
 * Un jugador baneado ahora no recibe eventos y queda en 3.0 — su historial no se
 * puede reconstruir. Van en `reseteados_a_base`.
 */
export async function recalcularRatings(
  admin: Admin,
  clubId: string,
  opts: { reiniciar: boolean; desdeFecha?: string | null; lote?: number }
): Promise<ResultadoRecalculo> {
  const lote = opts.lote ?? RECALC_LOTE
  const out: ResultadoRecalculo = {
    reiniciado: opts.reiniciar,
    partidos_procesados: 0,
    partidos_saltados: [],
    siguiente_fecha: null,
  }

  if (opts.reiniciar) {
    const { data: antesRows } = await admin
      .from('profiles')
      .select('id, username, habilidad, aprobado, baneado')
      .eq('club_id', clubId)
    type Prof = { id: string; username: string; habilidad: number | null; aprobado: boolean; baneado: boolean }
    const profs = (antesRows ?? []) as Prof[]

    out.antes = profs.map(p => ({
      username: p.username,
      rating: typeof p.habilidad === 'number' ? p.habilidad : BASE_RATING,
    }))
    out.reseteados_a_base = profs.filter(p => !p.aprobado || p.baneado).map(p => p.username)

    // El ledger completo, no por partido: `applyMatchRatings` corta con
    // 'ya_aplicado' si el partido tiene aunque sea un evento, así que dejar los
    // de un solo jugador saltearía el partido entero para todos.
    const { error: delErr } = await admin.from('rating_events').delete().eq('club_id', clubId)
    if (delErr) throw new Error(`No se pudo limpiar rating_events: ${delErr.message}`)

    const { error: resetErr } = await admin
      .from('profiles').update({ habilidad: BASE_RATING }).eq('club_id', clubId)
    if (resetErr) throw new Error(`No se pudo resetear habilidad: ${resetErr.message}`)
  }

  // El orden es obligatorio: `rating_after` es acumulativo y se recorta a [1,5],
  // así que aplicar en otro orden da otro número. Un partido por fecha
  // (UNIQUE club_id+fecha), así que la fecha sirve de cursor sin ambigüedad.
  const { data: partidos } = await admin
    .from('partidos')
    .select('id, fecha')
    .eq('club_id', clubId)
    .gte('fecha', opts.desdeFecha ?? '1970-01-01')
    .order('fecha', { ascending: true })
    .limit(lote + 1)

  const filas = (partidos ?? []) as { id: string; fecha: string }[]
  const aProcesar = filas.slice(0, lote)

  for (const p of aProcesar) {
    const r = await applyMatchRatings(admin, p.id)
    if (r.applied > 0) out.partidos_procesados++
    else out.partidos_saltados.push({ fecha: p.fecha, razon: r.skipped ?? 'sin_cambios' })
  }

  out.siguiente_fecha = filas.length > lote ? filas[lote].fecha : null

  if (out.siguiente_fecha === null) {
    const { data: despuesRows } = await admin
      .from('profiles').select('username, habilidad').eq('club_id', clubId)
    out.despues = ((despuesRows ?? []) as { username: string; habilidad: number | null }[])
      .map(p => ({ username: p.username, rating: typeof p.habilidad === 'number' ? p.habilidad : BASE_RATING }))
  }

  return out
}

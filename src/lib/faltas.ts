import type { createAdminClient } from '@/lib/supabase/admin'

// ── Faltas consecutivas ──────────────────────────────────────────────────────
// No inscribirse restaba rating en TODOS los partidos, y eso castigaba a quien
// simplemente no puede un día fijo: el club juega martes y viernes, y quien solo
// puede los martes perdía 0.02 cada viernes por el resto de su vida. No es
// inactividad, es tener horario.
//
// Ahora se necesita una RACHA. Con gap 3: la primera y la segunda falta seguidas
// no cuestan nada, y desde la tercera empieza a restar. La racha se corta con
// cualquier señal de presencia, así que el caso del martes se arregla solo:
//
//   M jugó · V faltó(1) · M jugó · V faltó(1) · …   nunca llega a 3
//   M faltó(1) · V faltó(2) · M faltó(3) ← acá empieza a restar
//
// Qué CORTA la racha (y por qué):
//   · jugó (confirmado)      se presentó
//   · quedó en espera        se inscribió; que no entrara no es culpa suya
//   · ausencia de admin      viaje o lesión, ya está exento del castigo
//   · partidos anteriores a
//     su llegada al club     no pudo inscribirse a algo que no existía para él
//
// Una ausencia corta la racha en vez de solo saltarla: quien vuelve de un viaje
// arranca de cero y no con la cuenta que traía de antes.

export const FALTAS_CONFIG = [
  {
    key: 'rating_faltas_gap',
    label: 'Faltas seguidas antes de restar',
    desc: 'Cuántos partidos consecutivos sin inscribirse hacen falta para que empiece a bajar el rating. Con 1 resta siempre, como antes',
    def: '3', min: 1, max: 10,
  },
] as const

export const FALTAS_CONFIG_KEYS = FALTAS_CONFIG.map(c => c.key) as readonly string[]

const GAP = FALTAS_CONFIG[0]

/** Lee el gap de faltas de un mapa de settings ya leído. */
export function faltasGapDeSettings(settings: Record<string, unknown>): number {
  const n = parseInt(String(settings[GAP.key] ?? GAP.def), 10)
  if (isNaN(n)) return parseInt(GAP.def, 10)
  return Math.max(GAP.min, Math.min(GAP.max, n))
}

/** Lee el gap de faltas configurado del club. */
export async function getFaltasGap(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string
): Promise<number> {
  const { data } = await admin
    .from('app_settings')
    .select('value')
    .eq('club_id', clubId)
    .eq('key', GAP.key)
    .maybeSingle()
  return faltasGapDeSettings({ [GAP.key]: (data as { value?: unknown } | null)?.value })
}

export interface PartidoRacha {
  id: string
  fecha: string
}

/**
 * Cuántas faltas seguidas trae el jugador contando hacia atrás desde el partido
 * actual, que es `partidos[0]`.
 *
 * `partidos` va del más reciente al más antiguo y solo incluye partidos que se
 * jugaron. Se corta en la primera señal de presencia: el resultado es 0 si se
 * presentó al partido actual, 1 si esta es su primera falta seguida, y así.
 */
export function rachaDeFaltas(opts: {
  partidos: PartidoRacha[]
  /** partido_id → estado del jugador en ese partido, si se inscribió. */
  estadoPorPartido: Map<string, string | undefined>
  /** ¿Un admin lo marcó ausente en esa fecha? */
  ausenteEnFecha: (fecha: string) => boolean
  /** YYYY-MM-DD desde el que el jugador existe en el club. */
  desdeFecha: string
}): number {
  let racha = 0
  for (const p of opts.partidos) {
    // Anterior a su llegada: no pudo faltar a algo que no existía para él, y
    // todo lo de más atrás es aún más viejo.
    if (p.fecha < opts.desdeFecha) break
    const estado = opts.estadoPorPartido.get(p.id)
    if (estado === 'confirmado' || estado === 'espera') break
    if (opts.ausenteEnFecha(p.fecha)) break
    racha++
  }
  return racha
}

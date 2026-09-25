import type { createAdminClient } from '@/lib/supabase/admin'
import { getClubBadges } from '@/lib/categorias'
import { getThumbsPaso, getCastigoNoVotar, castigaEnFecha, getQuorum } from '@/lib/reconocimientos'
import { ausenteEn, type Ausencia } from '@/lib/ausencia'
import { getFaltasGap, rachaDeFaltas, type PartidoRacha } from '@/lib/faltas'
import {
  calcularPuntaje, clampRating, round3,
  BASE_RATING, type Resultado, type SenalesPartido,
} from '@/lib/puntaje'

// ── Player rating (v2) ───────────────────────────────────────────────────────
// Stateful 1–5 rating stored on profiles.habilidad. Everyone starts at 3.0 and
// the number is earned on the field: small per-match deltas, clamped so no
// single game swings it wildly and no one can sit at the top untouched.
//
//   Jugó                     0 — presencia, no mérito (ver "deriva" abajo)
//   Ganó                     +STEP   ·  Perdió  −STEP  ·  Empató 0
//   Reconocimiento positivo  +STEP each  (MVP, goleador, defensa, portero, técnico)
//   Reconocimiento negativo  −STEP each  (desaparecido, aizaga, discutidor)
//   Pulgares                 +STEP por cada N 👍  ·  −STEP por cada N 👎
//   Jugó y no votó           −STEP  (solo si abrieron votaciones, el partido
//                            está dentro del período configurado, y la votación
//                            NO llegó al quórum de votantes)
//   No se inscribió (pudo)   −STEP, pero solo desde la N-ésima falta SEGUIDA
//   En espera                exento (no baja)
//   Ausente (lo marca admin) exento solo si NO jugó — ver lib/ausencia.ts
//
// Las faltas necesitan racha (rating_faltas_gap, default 3) porque restar en
// cada partido castigaba a quien no puede un día fijo: el club juega martes y
// viernes, y quien solo puede los martes perdía 0.02 cada viernes para siempre.
// Ver lib/faltas.ts.
//
// N es configurable por club (reco_thumbs_paso, default 3): un pulgar suelto no
// mueve a nadie. Los dos lados cuentan por separado — 4 👍 y 3 👎 son un escalón
// arriba y uno abajo, no "uno neto".
//
// Net per match is clamped to ±CAP so a great game is at most +CAP and a bad one
// at most −CAP. Applied once per match via the rating_events ledger (idempotent
// and reversible).
//
// Los pasos se mantienen chicos a propósito: subir cuesta y bajar cuesta. Por
// eso el número se muestra con dos decimales (formatRating en lib/tier) — con
// uno, un partidazo no movía nada visible y el sistema parecía muerto.
//
// ── Deriva: por qué jugar no suma ───────────────────────────────────────────
// Hasta 2026-09-17 inscribirse daba +STEP. Era el único término que no tenía
// contrapeso: ganar/perder es suma cero entre los dos equipos, pero el +STEP por
// aparecer se lo llevaba todo el que jugaba, en todos los partidos. A dos
// partidos por semana eso son +2.0 al año, así que los que van siempre llegaban
// al techo de 5.0 en menos de un año y el rating dejaba de distinguir a nadie —
// el mismo problema que tenía con todos clavados en 3.0, apilados arriba.
//
// Jugar ahora vale 0. El incentivo de ir no desaparece, cambia de lado: faltar
// tres seguidas resta, así que ir sigue siendo mejor que no ir, solo que por
// evitar el castigo y no por cobrar el premio. Y el número pasa a medir cómo
// juegas, no cuántas veces apareciste, que es lo que el balanceador necesita.
//
// Queda una fuente de deriva que NO es de suma cero: los pulgares. Si el club da
// muchos más 👍 que 👎, todos suben. Se amortigua subiendo reco_thumbs_paso. Los
// reconocimientos tienen un sesgo menor por venir 5 positivos y 3 negativos de
// fábrica, configurable por club.

// La aritmética (STEP, topes, motivos) vive en lib/puntaje: la comparte el
// simulador de /puntaje, que es lo único que garantiza que la pantalla que le
// explica las reglas a la gente diga lo mismo que hace el servidor.

type Admin = ReturnType<typeof createAdminClient>

/** Badge id → sign, from the club's configured badges. */
async function badgeSigns(admin: Admin, clubId: string): Promise<{ pos: Set<string>; neg: Set<string> }> {
  const badges = await getClubBadges(admin, clubId)
  return {
    pos: new Set(badges.filter(b => b.signo === 'positivo').map(b => b.id)),
    neg: new Set(badges.filter(b => b.signo === 'negativo').map(b => b.id)),
  }
}

type Team = { nombre: string; color: string }
type Outcome = 'win' | 'draw' | 'loss' | null

interface RatingEventRow {
  club_id: string
  player_id: string
  partido_id: string
  delta: number
  motivos: string[]
  rating_after: number
}

/**
 * Apply the rating deltas for a finished match — exactly once.
 * Idempotent via the rating_events ledger (unique per partido+player). Only runs
 * when the match has a result AND evaluations are closed, so every signal
 * (activity, result, recognitions) is final.
 */
export async function applyMatchRatings(
  admin: Admin,
  partido_id: string
): Promise<{ applied: number; skipped?: string }> {
  const { data: partido } = await admin
    .from('partidos')
    .select('id, club_id, fecha, tipo, evaluaciones_abiertas, evaluaciones_ya_abiertas, goles_a, goles_b, puntos_blanco, puntos_negro, puntos_morado')
    .eq('id', partido_id)
    .single()

  if (!partido?.club_id) return { applied: 0, skipped: 'sin_partido' }
  if (partido.evaluaciones_abiertas) return { applied: 0, skipped: 'evaluaciones_abiertas' }

  // A match the admins marked as not played moves nobody's rating. Read on its
  // own so a missing column degrades to "apply" instead of silently skipping
  // every match the way a failed combined select would.
  {
    const { data: estado } = await admin.from('partidos').select('jugado').eq('id', partido_id).maybeSingle()
    if ((estado as { jugado?: boolean | null } | null)?.jugado === false) return { applied: 0, skipped: 'no_jugado' }
  }

  const esMini = partido.tipo === 'minitorneo'
  const gA = partido.goles_a, gB = partido.goles_b
  const pB = partido.puntos_blanco, pN = partido.puntos_negro, pM = partido.puntos_morado
  const hasResult = esMini
    ? [pB, pN, pM].every(p => typeof p === 'number')
    : typeof gA === 'number' && typeof gB === 'number'
  if (!hasResult) return { applied: 0, skipped: 'sin_resultado' }

  // Already applied?
  const { count: already } = await admin
    .from('rating_events').select('id', { count: 'exact', head: true }).eq('partido_id', partido_id)
  if ((already ?? 0) > 0) return { applied: 0, skipped: 'ya_aplicado' }

  const clubId = partido.club_id as string

  const { data: equipos } = await admin
    .from('equipos').select('id, nombre, color').eq('partido_id', partido_id)
  const equipoById = new Map<string, Team>()
  for (const e of (equipos ?? []) as { id: string; nombre: string; color: string }[]) {
    equipoById.set(e.id, { nombre: e.nombre, color: e.color })
  }
  const equipoIds = [...equipoById.keys()]

  const { pos: POSITIVE_BADGES, neg: NEGATIVE_BADGES } = await badgeSigns(admin, clubId)

  const [insRes, ejRes, badgesRes, profsRes, thumbsRes, thumbsPaso, castigoNoVotar, votosRes] = await Promise.all([
    admin.from('inscripciones').select('player_id, estado').eq('partido_id', partido_id).in('estado', ['confirmado', 'espera']),
    equipoIds.length
      ? admin.from('equipo_jugadores').select('player_id, equipo_id').in('equipo_id', equipoIds)
      : Promise.resolve({ data: [] as { player_id: string; equipo_id: string }[] }),
    admin.from('player_badges').select('player_id, badge_id').eq('partido_id', partido_id),
    admin.from('profiles').select('id, habilidad, aprobado, baneado, created_at, ausente_desde, ausente_hasta').eq('club_id', clubId),
    admin.from('player_thumbs').select('votante_id, votado_id, value').eq('partido_id', partido_id),
    getThumbsPaso(admin, clubId),
    getCastigoNoVotar(admin, clubId),
    admin.from('votos_reconocimiento').select('votante_id').eq('partido_id', partido_id),
  ])

  // Quién entregó su evaluación. Cuenta cualquier cosa enviada — votos por
  // categoría, abstenciones ("No aplica") y pulgares: se castiga no abrir la
  // pantalla, no el contenido.
  const votaron = new Set<string>()
  for (const v of (votosRes.data ?? []) as { votante_id: string }[]) votaron.add(v.votante_id)
  for (const t of (thumbsRes.data ?? []) as { votante_id: string }[]) votaron.add(t.votante_id)

  // El castigo por no votar tiene tres condiciones, y las tres importan:
  //
  // 1. Las votaciones se abrieron. Un partido al que solo se le cargó el
  //    marcador castigaría a los 14 por algo que jamás pudieron hacer.
  // 2. El partido es del período en que la regla ya existe. La fecha la pone el
  //    club; sin fecha no se castiga nada, así que un recálculo no la vuelve
  //    retroactiva sobre partidos de cuando nadie sabía que esto existía.
  // 3. La votación NO llegó al quórum de votantes. Si alcanzó, los
  //    reconocimientos se repartieron igual y no hubo daño — el castigo existe
  //    para que haya votos suficientes, no para cobrarle a cada quien.
  const huboVotacion = (partido as { evaluaciones_ya_abiertas?: boolean | null }).evaluaciones_ya_abiertas === true
  const quorumVotantes = await getQuorum(admin, clubId)
  const alcanzoQuorum = votaron.size >= quorumVotantes.minVotantes
  const castigaNoVotar =
    huboVotacion &&
    castigaEnFecha(castigoNoVotar, partido.fecha as string) &&
    !alcanzoQuorum

  // ── Racha de faltas ────────────────────────────────────────────────────────
  // Basta con este partido y los (gap − 1) anteriores: si la racha no llega a
  // gap dentro de esa ventana, no llega, y no hay para qué leer el historial
  // completo. Solo partidos que se jugaron — faltar a uno que se canceló no es
  // faltar. `jugado` NULL es "nadie respondió aún" y cuenta como jugado, igual
  // que arriba.
  const faltasGap = await getFaltasGap(admin, clubId)
  const { data: ultimosPartidos } = await admin
    .from('partidos')
    .select('id, fecha, jugado')
    .eq('club_id', clubId)
    .lte('fecha', partido.fecha as string)
    .order('fecha', { ascending: false })
    .limit(faltasGap + 5)   // margen por si alguno salió como no jugado

  const ventana: PartidoRacha[] = ((ultimosPartidos ?? []) as { id: string; fecha: string; jugado: boolean | null }[])
    .filter(p => p.jugado !== false)
    .slice(0, faltasGap)

  const { data: insVentana } = ventana.length
    ? await admin
        .from('inscripciones')
        .select('partido_id, player_id, estado')
        .in('partido_id', ventana.map(p => p.id))
    : { data: [] as { partido_id: string; player_id: string; estado: string }[] }

  // player_id → (partido_id → estado)
  const estadoPorJugador = new Map<string, Map<string, string>>()
  for (const i of (insVentana ?? []) as { partido_id: string; player_id: string; estado: string }[]) {
    let m = estadoPorJugador.get(i.player_id)
    if (!m) { m = new Map(); estadoPorJugador.set(i.player_id, m) }
    m.set(i.partido_id, i.estado)
  }

  const confirmados = new Set<string>()
  const espera = new Set<string>()
  for (const i of (insRes.data ?? []) as { player_id: string; estado: string }[]) {
    if (i.estado === 'confirmado') confirmados.add(i.player_id)
    else if (i.estado === 'espera') espera.add(i.player_id)
  }

  const teamByPlayer = new Map<string, Team>()
  for (const ej of (ejRes.data ?? []) as { player_id: string; equipo_id: string }[]) {
    const t = equipoById.get(ej.equipo_id)
    if (t) teamByPlayer.set(ej.player_id, t)
  }

  const badgePos = new Map<string, number>()
  const badgeNeg = new Map<string, number>()
  for (const b of (badgesRes.data ?? []) as { player_id: string; badge_id: string }[]) {
    if (POSITIVE_BADGES.has(b.badge_id)) badgePos.set(b.player_id, (badgePos.get(b.player_id) ?? 0) + 1)
    else if (NEGATIVE_BADGES.has(b.badge_id)) badgeNeg.set(b.player_id, (badgeNeg.get(b.player_id) ?? 0) + 1)
  }

  const likes = new Map<string, number>()
  const dislikes = new Map<string, number>()
  for (const t of (thumbsRes.data ?? []) as { votado_id: string; value: number }[]) {
    const m = t.value === 1 ? likes : dislikes
    m.set(t.votado_id, (m.get(t.votado_id) ?? 0) + 1)
  }

  const ratingById = new Map<string, number>()
  const ausenciaById = new Map<string, Ausencia>()
  const desdeById = new Map<string, string>()
  const eligible: string[] = []
  for (const p of (profsRes.data ?? []) as ({ id: string; habilidad: number | null; aprobado: boolean; baneado: boolean; created_at: string | null } & Ausencia)[]) {
    ratingById.set(p.id, typeof p.habilidad === 'number' ? p.habilidad : BASE_RATING)
    ausenciaById.set(p.id, { ausente_desde: p.ausente_desde, ausente_hasta: p.ausente_hasta })
    // Fecha de llegada al club, para no contarle faltas a partidos anteriores.
    // created_at es timestamptz; el prefijo YYYY-MM-DD alcanza y compara bien
    // contra partidos.fecha, que ya es fecha de Colombia.
    desdeById.set(p.id, (p.created_at ?? '1970-01-01').slice(0, 10))
    if (p.aprobado && !p.baneado) eligible.push(p.id)
  }

  const outcome = (team: Team | undefined): Outcome => {
    if (!team) return null
    if (esMini) {
      const pts: Record<string, number> = {
        blanco: pB as number, negro: pN as number, morado: pM as number,
      }
      const own = pts[team.color]
      if (typeof own !== 'number') return null
      const max = Math.max(pB as number, pN as number, pM as number)
      if (own < max) return 'loss'
      const atMax = [pB, pN, pM].filter(p => p === max).length
      return atMax === 1 ? 'win' : 'draw'
    }
    const a = gA as number, b = gB as number
    if (team.nombre === 'A') return a === b ? 'draw' : a > b ? 'win' : 'loss'
    if (team.nombre === 'B') return b === a ? 'draw' : b > a ? 'win' : 'loss'
    return null
  }

  const events: RatingEventRow[] = []
  const updates: { id: string; rating: number }[] = []

  const reglas = { thumbsPaso, faltasGap, castigaNoVotar }
  const RESULTADO: Record<Exclude<Outcome, null>, Resultado> = {
    win: 'ganó', loss: 'perdió', draw: 'empató',
  }

  for (const id of eligible) {
    if (espera.has(id)) continue // exento

    const jugo = confirmados.has(id)
    // Marked away by an admin: no penalty for not signing up. Only matters when
    // they didn't play — a confirmed player takes the `jugo` branch.
    const ausente = !jugo && ausenteEn(ausenciaById.get(id), partido.fecha as string)

    // Faltó. Solo resta si ya viene una racha: la primera y la segunda falta
    // seguidas son gratis (con gap 3), y el que no puede los viernes nunca
    // acumula porque el martes que juega le corta la cuenta.
    const rachaFaltas = jugo || ausente ? 0 : rachaDeFaltas({
      partidos: ventana,
      estadoPorPartido: estadoPorJugador.get(id) ?? new Map(),
      ausenteEnFecha: fecha => ausenteEn(ausenciaById.get(id), fecha),
      desdeFecha: desdeById.get(id) ?? '1970-01-01',
    })

    const res = jugo ? outcome(teamByPlayer.get(id)) : null
    const senales: SenalesPartido = {
      jugo,
      resultado: res ? RESULTADO[res] : null,
      recoPos: badgePos.get(id) ?? 0,
      recoNeg: badgeNeg.get(id) ?? 0,
      likes: likes.get(id) ?? 0,
      dislikes: dislikes.get(id) ?? 0,
      voto: votaron.has(id),   // si castiga o no lo decide `reglas`
      ausente,
      rachaFaltas,
    }

    const { delta, motivos } = calcularPuntaje(senales, reglas, esMini)
    const old = ratingById.get(id) ?? BASE_RATING
    const rating_after = clampRating(round3(old + delta))

    events.push({ club_id: clubId, player_id: id, partido_id, delta, motivos, rating_after })
    if (rating_after !== old) updates.push({ id, rating: rating_after })
  }

  if (events.length === 0) return { applied: 0, skipped: 'sin_jugadores' }

  await admin.from('rating_events').insert(events)
  await Promise.all(
    updates.map(u => admin.from('profiles').update({ habilidad: u.rating }).eq('id', u.id))
  )

  return { applied: events.length }
}

/**
 * Reverse a match's applied rating deltas and clear its ledger rows. Used when
 * an admin reopens voting or re-enters a result, so re-closing recomputes fresh.
 */
export async function revertMatchRatings(
  admin: Admin,
  partido_id: string
): Promise<{ reverted: number }> {
  const { data: evs } = await admin
    .from('rating_events').select('player_id, delta').eq('partido_id', partido_id)
  if (!evs || evs.length === 0) return { reverted: 0 }

  const playerIds = evs.map(e => (e as { player_id: string }).player_id)
  const { data: profs } = await admin
    .from('profiles').select('id, habilidad').in('id', playerIds)
  const current = new Map<string, number>()
  for (const p of (profs ?? []) as { id: string; habilidad: number | null }[]) {
    current.set(p.id, typeof p.habilidad === 'number' ? p.habilidad : BASE_RATING)
  }

  await Promise.all(
    (evs as { player_id: string; delta: number }[]).map(e => {
      const next = clampRating(round3((current.get(e.player_id) ?? BASE_RATING) - e.delta))
      return admin.from('profiles').update({ habilidad: next }).eq('id', e.player_id)
    })
  )
  await admin.from('rating_events').delete().eq('partido_id', partido_id)

  return { reverted: evs.length }
}

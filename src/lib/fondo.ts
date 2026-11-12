// ── Fondo MBA ────────────────────────────────────────────────────────────────
//
// La plata del club. Cada partido se recoge un monto para pagar la cancha y
// sobra algo (típicamente 14.000) que va al fondo; el fondo vive en una cuenta
// Nu y de ahí salen los gastos.
//
// Esto se llevaba a mano en un mensaje de WhatsApp, una línea por partido, y la
// pestaña 💰 mostraba otra cosa: una cuenta TEÓRICA de 1.000 por persona y por
// partido, derivada de las inscripciones. Servía como ranking de mérito, no
// como la plata del club — y sobre todo, no tenía resta: el número era lo
// recaudado bruto desde el primer partido, nunca un saldo.
//
// Ahora la fuente es `fondo_movimientos`, un libro con el signo dentro del
// monto. El saldo es la suma, sin reglas aparte:
//
//     saldo = recaudado + gastado + ajustes        (gastado es negativo)
//
// Lo que NO cambia es el reparto entre jugadores: sigue contándose desde las
// INSCRIPCIONES confirmadas y no desde `rating_events`. Un partido que nadie
// cerró (sin admin, sin marcador) no tiene eventos de puntaje, pero la cancha se
// pagó igual: esa gente sí aportó.

export type TipoMovimiento = 'aporte' | 'gasto' | 'ajuste' | 'sin_recoger' | 'pendiente'

export interface Movimiento {
  id: string
  fecha: string                  // YYYY-MM-DD
  tipo: TipoMovimiento
  /** Firmado: positivo entra, negativo sale. 0 en sin_recoger y pendiente. */
  monto: number
  partido_id: string | null
  encargado_id: string | null
  encargado: { username: string; avatar_url: string | null } | null
  concepto: string | null
}

export interface SaldoFondo {
  saldo: number
  recaudado: number
  /** Negativo, para que la suma de los tres dé el saldo sin restar a mano. */
  gastado: number
  ajustes: number
  /** Cuántos partidos tienen plata sin entregar. */
  pendientes: number
  /** Cuántos partidos se revisaron y no aportaron nada. */
  sinRecoger: number
}

/**
 * Saldo y desglose. Las tres partidas suman el saldo exactamente, y por eso
 * `gastado` sale negativo: un desglose que no cuadra con su total es la clase de
 * pantalla que nadie vuelve a creer.
 */
export function calcularSaldo(movs: Movimiento[]): SaldoFondo {
  const s: SaldoFondo = { saldo: 0, recaudado: 0, gastado: 0, ajustes: 0, pendientes: 0, sinRecoger: 0 }
  for (const m of movs) {
    s.saldo += m.monto
    if (m.tipo === 'aporte') s.recaudado += m.monto
    else if (m.tipo === 'gasto') s.gastado += m.monto
    else if (m.tipo === 'ajuste') s.ajustes += m.monto
    else if (m.tipo === 'pendiente') s.pendientes++
    else if (m.tipo === 'sin_recoger') s.sinRecoger++
  }
  return s
}

export interface AporteMatch {
  partido_id: string
  fecha: string
  /** Lo que de verdad entró ese partido. Siempre > 0. */
  monto: number
}

export interface Participacion {
  partido_id: string
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

export interface ResumenRanking {
  /** Lo repartido: la suma de los aportes que tenían gente registrada. */
  total: number
  partidos: number
  desde: string | null
  ranking: AportanteFondo[]
  /** Los invitados no tienen cuenta: se suman en una sola línea. */
  invitados: { personas: number; total: number }
  /** Aportes que no se pudieron repartir porque no hay inscritos registrados. */
  sinRepartir: { partidos: number; total: number }
}

/**
 * Reparte el monto REAL de cada partido entre los que estuvieron (inscritos
 * confirmados + invitados confirmados). La cuota es `monto / personas`.
 *
 * Antes el aporte era 1.000 parejo para todos y en todos los partidos. Repartir
 * el monto real cambia dos cosas que importan: un partido donde no se recogió
 * aporta 0 a todos (que es la verdad), y un partido de 10 personas reparte más
 * por cabeza que uno de 18.
 *
 * El redondeo se deja para `formatoPesos`, al mostrar. La suma de las cuotas
 * redondeadas puede no dar el total al peso, y da igual: el número grande de la
 * pantalla sale de `calcularSaldo`, no de acá, así que nunca se contradicen.
 */
export function calcularRanking(
  aportes: AporteMatch[],
  jugadores: Participacion[],
  invitados: { partido_id: string }[]
): ResumenRanking {
  const aportePorPartido = new Map<string, AporteMatch>()
  for (const a of aportes) aportePorPartido.set(a.partido_id, a)

  // Cuánta gente hay que repartirle a cada partido. Se cuenta sobre TODOS los
  // partidos, no solo los que tienen aporte, porque el mismo conteo decide si un
  // aporte se puede repartir o no.
  const personas = new Map<string, number>()
  const vistoJugador = new Set<string>()   // partido|jugador, contra páginas que se pisan
  for (const j of jugadores) {
    const k = `${j.partido_id}|${j.player_id}`
    if (vistoJugador.has(k)) continue
    vistoJugador.add(k)
    personas.set(j.partido_id, (personas.get(j.partido_id) ?? 0) + 1)
  }
  const invitadosPorPartido = new Map<string, number>()
  for (const i of invitados) {
    invitadosPorPartido.set(i.partido_id, (invitadosPorPartido.get(i.partido_id) ?? 0) + 1)
    personas.set(i.partido_id, (personas.get(i.partido_id) ?? 0) + 1)
  }

  const cuota = (partidoId: string): number => {
    const a = aportePorPartido.get(partidoId)
    const n = personas.get(partidoId) ?? 0
    if (!a || n === 0) return 0
    return a.monto / n
  }

  const porJugador = new Map<string, AportanteFondo & { _vistos: Set<string> }>()
  const partidos = new Set<string>()
  let desde: string | null = null

  for (const j of jugadores) {
    const a = aportePorPartido.get(j.partido_id)
    if (!a) continue                       // partido sin plata registrada: no reparte nada
    partidos.add(j.partido_id)
    if (!desde || a.fecha < desde) desde = a.fecha

    let p = porJugador.get(j.player_id)
    if (!p) {
      p = {
        player_id: j.player_id, username: j.username, avatar_url: j.avatar_url,
        partidos: 0, total: 0, puesto: 0, primera: a.fecha, ultima: a.fecha, fechas: [],
        _vistos: new Set(),
      }
      porJugador.set(j.player_id, p)
    }
    if (p._vistos.has(j.partido_id)) continue
    p._vistos.add(j.partido_id)
    p.partidos++
    p.total += cuota(j.partido_id)
    p.fechas.push(a.fecha)
    if (a.fecha < p.primera) p.primera = a.fecha
    if (a.fecha > p.ultima) p.ultima = a.fecha
  }

  // El que más ha puesto, primero. A igual plata, el que aportó más reciente
  // (sigue activo), y después por nombre para que el orden no baile.
  const ranking = [...porJugador.values()]
    .map(({ _vistos, ...p }) => ({ ...p, fechas: [...p.fechas].sort().reverse() }))
    .sort((x, y) => y.total - x.total || y.ultima.localeCompare(x.ultima) || x.username.localeCompare(y.username))

  // Puesto con empates: 1, 2, 2, 4. Dos personas con la misma plata puesta están
  // igual de arriba, y el orden por fecha es solo para leer la lista.
  let puesto = 0
  ranking.forEach((p, i) => {
    if (i === 0 || p.total !== ranking[i - 1].total) puesto = i + 1
    p.puesto = puesto
  })

  let invitadosPersonas = 0, invitadosTotal = 0
  for (const [partidoId, n] of invitadosPorPartido) {
    if (!aportePorPartido.has(partidoId)) continue
    partidos.add(partidoId)
    invitadosPersonas += n
    invitadosTotal += cuota(partidoId) * n
  }

  // Un aporte sin nadie a quien repartirle. Pasa con los dos de mayo de 2026,
  // anteriores al primer partido que hay en la base, y con cualquier partido al
  // que nadie alcanzó a inscribirse en la app. Se muestra aparte en vez de
  // diluirlo entre los demás: la plata entró, pero no es de nadie en el ranking.
  let sinRepartirPartidos = 0, sinRepartirTotal = 0
  for (const a of aportes) {
    if ((personas.get(a.partido_id) ?? 0) > 0) continue
    sinRepartirPartidos++
    sinRepartirTotal += a.monto
  }

  const total = ranking.reduce((s, p) => s + p.total, 0) + invitadosTotal

  return {
    total,
    partidos: partidos.size,
    desde,
    ranking,
    invitados: { personas: invitadosPersonas, total: invitadosTotal },
    sinRepartir: { partidos: sinRepartirPartidos, total: sinRepartirTotal },
  }
}

/** "$ 1.234.000" — armado a mano, igual en servidor y navegador. */
export function formatoPesos(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '−' : ''}$ ${s}`
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import {
  fichaDeEventos, cruzarEquipos, resultadoDeMotivos,
  esResultado, esRelacion, esFecha, tamanoPagina,
  type FilaEquipo,
} from '@/lib/historial'

export const dynamic = 'force-dynamic'

// GET /api/historial — historial del club con filtros.
//
// Va por el servidor y no desde el navegador (como hacía la página vieja)
// por dos razones:
//
//  1. La ficha ("28G-14P-5E, 60%") es un conteo sobre TODO el filtro, no sobre
//     la página que se ve. Filtrar en el cliente lo que llegó paginado daría
//     números falsos — el mismo error del "2 de 14 votaron".
//  2. El `club_id` se fuerza en un solo sitio.
//
// El club sale del perfil del usuario, nunca de un parámetro: si viniera del
// cliente, cualquiera pediría el historial de otro club.

type Admin = ReturnType<typeof createAdminClient>

/** Los partidos en los que un jugador estuvo en un equipo, con cuál equipo. */
async function equiposDe(admin: Admin, clubId: string, playerId: string): Promise<FilaEquipo[]> {
  const { data } = await admin
    .from('equipo_jugadores')
    .select('equipo_id, equipos!inner(partido_id)')
    .eq('club_id', clubId)
    .eq('player_id', playerId)
  type Fila = { equipo_id: string; equipos: { partido_id: string } | { partido_id: string }[] | null }
  return ((data ?? []) as Fila[]).flatMap(f => {
    // PostgREST devuelve el embebido como objeto o como array según la relación.
    const eq = Array.isArray(f.equipos) ? f.equipos[0] : f.equipos
    return eq?.partido_id ? [{ partido_id: eq.partido_id, equipo_id: f.equipo_id }] : []
  })
}

const CAMPOS_PARTIDO =
  'id, fecha, dia_semana, hora, resultado, goles_a, goles_b, tipo, lugar, ' +
  'puntos_blanco, puntos_negro, puntos_morado, foto_url, ' +
  'player_badges(badge_id, badge_emoji, badge_nombre, votos, player_id, ' +
  'profiles!player_badges_player_id_fkey(username, avatar_url))'

/**
 * Color del equipo de cada jugador, por partido: `${partido_id}:${player_id}`.
 *
 * Va en UNA consulta para toda la página y no una por partido. Con 15 partidos
 * a 14 jugadores son ~210 filas, muy por debajo del tope de PostgREST.
 */
async function coloresPorJugador(admin: Admin, clubId: string, partidoIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (partidoIds.length === 0) return m
  const { data } = await admin
    .from('equipo_jugadores')
    .select('player_id, equipos!inner(partido_id, color)')
    .eq('club_id', clubId)
    .in('equipos.partido_id', partidoIds)
  type Fila = { player_id: string; equipos: { partido_id: string; color: string | null } | { partido_id: string; color: string | null }[] | null }
  for (const f of (data ?? []) as Fila[]) {
    const eq = Array.isArray(f.equipos) ? f.equipos[0] : f.equipos
    if (eq?.partido_id && eq.color) m.set(`${eq.partido_id}:${f.player_id}`, eq.color)
  }
  return m
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: perfil } = await admin
    .from('profiles').select('club_id, aprobado, role').eq('id', user.id).single()
  const p = perfil as { club_id?: string | null; aprobado?: boolean; role?: string } | null
  const clubId = p?.club_id
  if (!clubId) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  if (!p?.aprobado && p?.role !== 'admin' && p?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Cuenta pendiente de aprobación' }, { status: 403 })
  }

  const q = req.nextUrl.searchParams
  const jugador = q.get('jugador')
  const rival = q.get('rival')
  const relacion = q.get('relacion')
  const resultado = q.get('resultado')
  const desde = q.get('desde')
  const hasta = q.get('hasta')
  const tam = tamanoPagina(q.get('tam'))
  const offset = Math.max(0, Number(q.get('offset')) || 0)

  if (jugador !== null && !isUUID(jugador)) return NextResponse.json({ error: 'jugador inválido' }, { status: 400 })
  if (rival !== null && !isUUID(rival)) return NextResponse.json({ error: 'rival inválido' }, { status: 400 })
  if (resultado !== null && !esResultado(resultado)) return NextResponse.json({ error: 'resultado inválido' }, { status: 400 })
  if (relacion !== null && !esRelacion(relacion)) return NextResponse.json({ error: 'relacion inválida' }, { status: 400 })
  if (desde !== null && !esFecha(desde)) return NextResponse.json({ error: 'desde inválida' }, { status: 400 })
  if (hasta !== null && !esFecha(hasta)) return NextResponse.json({ error: 'hasta inválida' }, { status: 400 })
  // Filtrar por resultado sin jugador no significa nada: un partido no lo gana
  // el club, lo gana un equipo. La UI no lo ofrece; esto lo hace explícito.
  if (resultado && !jugador) return NextResponse.json({ error: 'El resultado necesita un jugador' }, { status: 400 })
  if (rival && !jugador) return NextResponse.json({ error: 'El rival necesita un jugador' }, { status: 400 })

  const hoy = new Date().toISOString().split('T')[0]

  // Fecha del primer partido del club: la UI arma con esto la lista de años y
  // de meses, en vez de inventarse un rango que puede no existir.
  const { data: primeroRows } = await admin
    .from('partidos').select('fecha').eq('club_id', clubId).order('fecha', { ascending: true }).limit(1)
  const desde_minimo = ((primeroRows ?? []) as { fecha: string }[])[0]?.fecha ?? null

  // ── Cruce "con / contra": qué partidos entran ────────────────────────────
  let idsPermitidos: string[] | null = null
  let cruce: { con: number; contra: number } | null = null
  if (jugador && rival) {
    if (rival === jugador) return NextResponse.json({ error: 'Elige dos jugadores distintos' }, { status: 400 })
    const [mios, suyos] = await Promise.all([
      equiposDe(admin, clubId, jugador),
      equiposDe(admin, clubId, rival),
    ])
    const c = cruzarEquipos(mios, suyos)

    // El cruce TIENE que respetar el mismo filtro de fechas que todo lo demás.
    // Sin esto, con el año 2026 puesto la ficha decía "8 jugados" (solo 2026)
    // mientras el pie decía "Juntos 9 · En contra 2" contando todos los años:
    // dos números contradictorios en la misma tarjeta.
    //
    // Se filtra consultando `partidos` por los ids candidatos y no leyendo el
    // calendario entero: el cruce son a lo sumo los partidos que jugó una
    // persona, así que la consulta queda acotada por más que crezca el club.
    const candidatos = [...c.con, ...c.contra]
    let validos = new Set(candidatos)
    if (candidatos.length > 0) {
      let qv = admin.from('partidos').select('id').eq('club_id', clubId).in('id', candidatos).lt('fecha', hoy)
      if (desde) qv = qv.gte('fecha', desde)
      if (hasta) qv = qv.lte('fecha', hasta)
      const { data: vRows } = await qv
      validos = new Set(((vRows ?? []) as { id: string }[]).map(r => r.id))
    }
    const con = c.con.filter(id => validos.has(id))
    const contra = c.contra.filter(id => validos.has(id))

    cruce = { con: con.length, contra: contra.length }
    idsPermitidos = relacion === 'contra' ? contra : relacion === 'con' ? con : [...con, ...contra]
    if (idsPermitidos.length === 0) {
      return NextResponse.json({ ok: true, partidos: [], ficha: null, cruce, hay_mas: false, desde_minimo })
    }
  }

  // ── La ficha: conteo sobre TODO el filtro, no sobre la página ────────────
  // Se pide aparte y sin paginar porque son pocas filas (una por partido del
  // jugador) y es el único modo de que los totales no mientan.
  let ficha = null
  if (jugador) {
    let qf = admin
      .from('rating_events')
      .select('motivos, partidos!inner(fecha)')
      .eq('club_id', clubId)
      .eq('player_id', jugador)
      .lt('partidos.fecha', hoy)
    if (desde) qf = qf.gte('partidos.fecha', desde)
    if (hasta) qf = qf.lte('partidos.fecha', hasta)
    if (idsPermitidos) qf = qf.in('partido_id', idsPermitidos)
    const { data } = await qf
    ficha = fichaDeEventos((data ?? []) as { motivos: unknown }[])
  }

  // ── La página de partidos ────────────────────────────────────────────────
  // Se consulta desde `partidos` (no desde rating_events) para poder ordenar
  // por fecha: PostgREST no ordena la tabla principal por una columna
  // embebida. Ojo — `rating_events.created_at` NO sirve para ordenar: es
  // cuándo se escribió el evento, y tras el último recálculo son casi todos
  // el mismo instante.
  let qp = admin.from('partidos').select(
    jugador ? `${CAMPOS_PARTIDO}, rating_events!inner(motivos, player_id)` : CAMPOS_PARTIDO
  ).eq('club_id', clubId).lt('fecha', hoy)

  if (desde) qp = qp.gte('fecha', desde)
  if (hasta) qp = qp.lte('fecha', hasta)
  if (idsPermitidos) qp = qp.in('id', idsPermitidos)
  if (jugador) {
    qp = qp.eq('rating_events.player_id', jugador)
    if (resultado) qp = qp.contains('rating_events.motivos', [resultado])
  }

  // Se pide uno de más para saber si hay página siguiente sin un count aparte.
  const { data: filas, error } = await qp
    .order('fecha', { ascending: false })
    .range(offset, offset + tam)

  if (error) {
    console.error('[historial]', error)
    return NextResponse.json({ error: 'No se pudo cargar el historial' }, { status: 500 })
  }

  const todas = (filas ?? []) as unknown as Record<string, unknown>[]
  const hay_mas = todas.length > tam
  const visibles = todas.slice(0, tam)

  // El color de equipo de los premiados, para el punto de la tarjeta.
  const colores = await coloresPorJugador(admin, clubId, visibles.map(f => f.id as string))

  const pagina = visibles.map(f => {
    // `rating_events` viene embebido solo para filtrar; se convierte en el
    // resultado del jugador y no se devuelve crudo.
    const ev = f.rating_events as { motivos: unknown }[] | { motivos: unknown } | undefined
    const uno = Array.isArray(ev) ? ev[0] : ev
    const { rating_events: _omitido, ...resto } = f

    const badges = ((f.player_badges ?? []) as { player_id?: string }[]).map(b => ({
      ...b, equipo_color: colores.get(`${f.id as string}:${b.player_id ?? ''}`) ?? null,
    }))

    return { ...resto, player_badges: badges, mi_resultado: uno ? resultadoDeMotivos(uno.motivos) : null }
  })

  return NextResponse.json({ ok: true, partidos: pagina, ficha, cruce, hay_mas, desde_minimo })
}

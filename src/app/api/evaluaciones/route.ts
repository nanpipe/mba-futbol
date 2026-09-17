import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'
import { getClubBadges } from '@/lib/categorias'
import { getQuorum, getThumbsPaso, decidirCategoria, explicarSinAsignar } from '@/lib/reconocimientos'
import { isRateLimited, getClientIp } from '@/lib/rateLimit'
import { applyMatchRatings, revertMatchRatings } from '@/lib/rating'

export const dynamic = 'force-dynamic'

export interface GanadorAPI {
  username: string
  /** Tiene el badge en player_badges. False si el quórum no alcanzó o se lo quitaron. */
  asignado: boolean
  /** Un admin se lo quitó a mano. */
  revocado: boolean
}

export interface ResultadoAPI {
  categoria: string
  emoji: string
  nombre: string
  /** Nombres del tope, unidos — se mantiene para las vistas que solo pintan texto. */
  ganador: string
  ganadores: GanadorAPI[]
  /** Votos que recibió cada uno de los del tope. */
  votos: number
  /** Cuántos respondieron "No aplica" en esta categoría. */
  abstenciones: number
  asignado: boolean
  empate: boolean
  /** Por qué la categoría quedó sin dueño. null si se asignó. */
  motivo: string | null
}

// ── Shared: tally votes → assign player_badges ────────────────────────────────
export async function tallyAndAssign(
  admin: ReturnType<typeof createAdminClient>,
  partido_id: string
): Promise<{ badges_asignados: number; sin_quorum: number }> {
  // Fetch club_id from partidos (required for player_badges NOT NULL constraint)
  const { data: partidoInfo } = await admin
    .from('partidos')
    .select('club_id')
    .eq('id', partido_id)
    .single()

  if (!partidoInfo?.club_id) return { badges_asignados: 0, sin_quorum: 0 }
  const club_id = partidoInfo.club_id

  const { data: votos } = await admin
    .from('votos_reconocimiento')
    .select('votante_id, votado_id, categoria')
    .eq('partido_id', partido_id)

  if (!votos || votos.length === 0) return { badges_asignados: 0, sin_quorum: 0 }

  // Clear this match's badges first so a re-tally fully recomputes — otherwise a
  // category whose winner changed keeps BOTH winners (upsert only dedups per
  // player, not per category).
  await admin.from('player_badges').delete().eq('partido_id', partido_id)

  const [quorum, { data: revocados }] = await Promise.all([
    getQuorum(admin, club_id),
    admin.from('badges_revocados').select('player_id, badge_id').eq('partido_id', partido_id),
  ])

  // Un badge que un admin quitó no vuelve en el re-conteo.
  const vetados = new Set(
    ((revocados ?? []) as { player_id: string; badge_id: string }[])
      .map(r => `${r.badge_id}:${r.player_id}`)
  )

  const tally: Record<string, Record<string, number>> = {}
  const votantes = new Set<string>()
  for (const v of votos) {
    // Una abstención ("No aplica") cuenta como votante del partido y no le
    // suma a nadie: el jugador respondió, solo que no señaló a nadie.
    votantes.add(v.votante_id)
    if (!v.votado_id) continue
    if (!tally[v.categoria]) tally[v.categoria] = {}
    tally[v.categoria][v.votado_id] = (tally[v.categoria][v.votado_id] ?? 0) + 1
  }

  let badges_asignados = 0
  let sin_quorum = 0
  for (const cat of await getClubBadges(admin, club_id)) {
    const catVotes = tally[cat.id]
    if (!catVotes) continue

    const decision = decidirCategoria(catVotes, votantes.size, quorum)
    if (!decision.asignado) {
      sin_quorum++
      continue
    }

    // Un empate en el tope se lleva el reconocimiento entero cada uno: elegir
    // "el primero" sería una moneda al aire, justo lo que este cambio evita.
    for (const winnerId of decision.ids) {
      if (vetados.has(`${cat.id}:${winnerId}`)) continue
      const { error: upsertErr } = await admin.from('player_badges').upsert({
        club_id,
        player_id: winnerId,
        badge_id: cat.id,
        badge_emoji: cat.emoji,
        badge_nombre: cat.nombre,
        partido_id,
        // Guardado aquí para que la tarjeta de resultados lo muestre sin que el
        // cliente tenga que leer los votos, que traen votante_id.
        votos: decision.votos,
      }, { onConflict: 'player_id,badge_id,partido_id' })
      if (upsertErr) {
        console.error('[tallyAndAssign] upsert error for cat', cat.id, ':', upsertErr.message, upsertErr.code)
      } else {
        badges_asignados++
      }
    }
  }

  return { badges_asignados, sin_quorum }
}

// ── GET /api/evaluaciones?partido_id=xxx ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await admin.from('profiles').select('club_id').eq('id', user.id).single()
  if (!profile?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = profile.club_id

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas, fecha, dia_semana')
    .eq('club_id', clubId)
    .eq('id', partido_id)
    .single()

  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  // Must be a confirmed participant
  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .eq('estado', 'confirmado')
    .maybeSingle()

  if (!inscripcion) return NextResponse.json({ error: 'No estás en la lista de este partido' }, { status: 403 })

  // Already voted?
  const { count } = await admin
    .from('votos_reconocimiento')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('votante_id', user.id)

  const yaVoto = (count ?? 0) > 0

  // Teammates to vote for (only needed when open)
  const { data: compañeros } = partido.evaluaciones_abiertas ? await admin
    .from('inscripciones')
    .select('player_id, profiles!player_id(id, username, avatar_url, posicion)')
    .eq('partido_id', partido_id)
    .eq('estado', 'confirmado')
    .neq('player_id', user.id) : { data: null }

  const clubBadges = await getClubBadges(admin, clubId)

  // Results: winners, vote counts, and why a category ended up empty (when
  // closed or just voted). Se arma desde los votos y no desde player_badges:
  // así una categoría sin quórum también aparece, con su explicación.
  let resultados: ResultadoAPI[] | null = null
  let votantesTotal = 0
  let quorumInfo: { minVotos: number; minVotantes: number; minGanador: number } | null = null

  if (!partido.evaluaciones_abiertas || yaVoto) {
    const [{ data: votosData }, { data: asignados }, { data: revocados }, quorum] = await Promise.all([
      admin.from('votos_reconocimiento').select('votante_id, votado_id, categoria').eq('partido_id', partido_id),
      admin.from('player_badges').select('badge_id, player_id').eq('partido_id', partido_id),
      admin.from('badges_revocados').select('badge_id, player_id').eq('partido_id', partido_id),
      getQuorum(admin, clubId),
    ])

    const tally: Record<string, Record<string, number>> = {}
    const votantes = new Set<string>()
    const abstenciones: Record<string, number> = {}
    for (const v of (votosData ?? []) as { votante_id: string; votado_id: string | null; categoria: string }[]) {
      votantes.add(v.votante_id)
      if (!v.votado_id) {
        abstenciones[v.categoria] = (abstenciones[v.categoria] ?? 0) + 1
        continue
      }
      if (!tally[v.categoria]) tally[v.categoria] = {}
      tally[v.categoria][v.votado_id] = (tally[v.categoria][v.votado_id] ?? 0) + 1
    }
    votantesTotal = votantes.size
    quorumInfo = quorum

    if (votosData && votosData.length > 0) {
      // Usernames for everyone who topped a category.
      const topIds = new Set<string>()
      for (const cat of clubBadges) {
        for (const id of decidirCategoria(tally[cat.id] ?? {}, votantes.size, quorum).ids) topIds.add(id)
      }
      const { data: profs } = topIds.size
        ? await admin.from('profiles').select('id, username').in('id', [...topIds])
        : { data: [] as { id: string; username: string }[] }
      const nombrePorId = new Map(
        ((profs ?? []) as { id: string; username: string }[]).map(p => [p.id, p.username])
      )

      const asignadoSet = new Set(
        ((asignados ?? []) as { badge_id: string; player_id: string }[]).map(b => `${b.badge_id}:${b.player_id}`)
      )
      const revocadoSet = new Set(
        ((revocados ?? []) as { badge_id: string; player_id: string }[]).map(r => `${r.badge_id}:${r.player_id}`)
      )

      resultados = clubBadges
        .filter(cat => tally[cat.id] || abstenciones[cat.id])
        .map(cat => {
          const d = decidirCategoria(tally[cat.id] ?? {}, votantes.size, quorum)
          const ganadores = d.ids.map(id => ({
            username: nombrePorId.get(id) ?? '?',
            asignado: asignadoSet.has(`${cat.id}:${id}`),
            revocado: revocadoSet.has(`${cat.id}:${id}`),
          }))
          return {
            categoria: cat.id,
            emoji: cat.emoji,
            nombre: cat.nombre,
            ganador: ganadores.map(g => g.username).join(' y ') || '—',
            ganadores,
            votos: d.votos,
            abstenciones: abstenciones[cat.id] ?? 0,
            asignado: d.asignado && ganadores.some(g => g.asignado),
            empate: d.empate,
            motivo: d.asignado ? null : explicarSinAsignar(d, votantes.size, quorum),
          }
        })
    }
  }

  // Voting progress (when open)
  let progreso: { votaron: number; total: number } | null = null
  if (partido.evaluaciones_abiertas) {
    const { data: todosVotantes } = await admin
      .from('votos_reconocimiento')
      .select('votante_id')
      .eq('partido_id', partido_id)
    const { count: totalConfirmados } = await admin
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('partido_id', partido_id)
      .eq('estado', 'confirmado')
    const uniqueVotantes = new Set((todosVotantes ?? []).map(v => v.votante_id)).size
    progreso = { votaron: uniqueVotantes, total: totalConfirmados ?? 0 }
  }

  return NextResponse.json({
    ok: true,
    abierto: partido.evaluaciones_abiertas,
    yaVoto,
    partido: { fecha: partido.fecha, dia_semana: partido.dia_semana },
    compañeros: (compañeros ?? []).map(c => (c as unknown as { profiles: object }).profiles),
    badges: clubBadges,
    resultados,
    progreso,
    votantes: votantesTotal,
    quorum: quorumInfo,
    thumbs_paso: await getThumbsPaso(admin, clubId),
  })
}

// ── POST /api/evaluaciones — submit votes ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (isRateLimited(`evaluaciones-post:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 })
  }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await admin.from('profiles').select('club_id').eq('id', user.id).single()
  if (!profile?.club_id) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  const clubId = profile.club_id

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id, votos, thumbs } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await admin
    .from('partidos')
    .select('evaluaciones_abiertas')
    .eq('club_id', clubId)
    .eq('id', partido_id)
    .single()

  if (!partido?.evaluaciones_abiertas) {
    return NextResponse.json({ error: 'La votación no está abierta.' }, { status: 403 })
  }

  const { data: inscripcion } = await admin
    .from('inscripciones')
    .select('id')
    .eq('partido_id', partido_id)
    .eq('player_id', user.id)
    .eq('estado', 'confirmado')
    .maybeSingle()

  if (!inscripcion) return NextResponse.json({ error: 'No participaste en este partido.' }, { status: 403 })

  const { count: yaVoto } = await admin
    .from('votos_reconocimiento')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id)
    .eq('votante_id', user.id)

  if ((yaVoto ?? 0) > 0) {
    return NextResponse.json({ error: 'Ya enviaste tus votos.' }, { status: 409 })
  }

  const { data: confirmados } = await admin
    .from('inscripciones')
    .select('player_id')
    .eq('partido_id', partido_id as string)
    .eq('estado', 'confirmado')

  const validTargets = new Set((confirmados ?? []).map((c: { player_id: string }) => c.player_id))

  const validCategorias = new Set((await getClubBadges(admin, clubId)).map(b => b.id))

  const rows: object[] = []
  const seen = new Set<string>()

  let abstenciones = 0
  for (const v of (votos as Array<Record<string, unknown>>) ?? []) {
    const { categoria, votado_id } = v
    if (typeof categoria !== 'string' || !validCategorias.has(categoria)) continue
    if (seen.has(categoria)) continue
    // "No aplica" es una respuesta: se guarda con votado_id NULL para poder
    // distinguir "todos dijeron que nadie" de "nadie miró la categoría".
    if (votado_id === null) {
      seen.add(categoria)
      abstenciones++
      rows.push({ club_id: clubId, partido_id, votante_id: user.id, votado_id: null, categoria })
      continue
    }
    if (!isUUID(votado_id)) continue
    if (votado_id === user.id) continue
    if (!validTargets.has(votado_id as string)) continue
    seen.add(categoria)
    rows.push({ club_id: clubId, partido_id, votante_id: user.id, votado_id, categoria })
  }

  // Thumbs up/down — one per target, must be a confirmed participant, not self
  const thumbRows: object[] = []
  const thumbSeen = new Set<string>()
  for (const t of (thumbs as Array<Record<string, unknown>>) ?? []) {
    const { votado_id, value } = t
    if (!isUUID(votado_id)) continue
    if (votado_id === user.id) continue
    if (!validTargets.has(votado_id as string)) continue
    if (value !== 1 && value !== -1) continue
    if (thumbSeen.has(votado_id as string)) continue
    thumbSeen.add(votado_id as string)
    thumbRows.push({ club_id: clubId, partido_id, votante_id: user.id, votado_id, value })
  }

  if (rows.length === 0 && thumbRows.length === 0) {
    return NextResponse.json({ error: 'No hay evaluaciones válidas.' }, { status: 400 })
  }

  if (rows.length > 0) {
    const { error } = await admin.from('votos_reconocimiento').insert(rows)
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Ya enviaste tus votos.' }, { status: 409 })
      return NextResponse.json({ error: 'Error guardando votos.' }, { status: 500 })
    }
  }

  if (thumbRows.length > 0) {
    const { error: thumbErr } = await admin.from('player_thumbs').insert(thumbRows)
    if (thumbErr && thumbErr.code !== '23505') {
      console.error('[evaluaciones] thumbs insert error:', thumbErr.message)
    }
  }

  await logActivity({
    user_id: user.id,
    accion: 'enviar_votos',
    detalles: {
      partido_id,
      categorias: rows.length - abstenciones,
      abstenciones,
      thumbs: thumbRows.length,
    },
  })

  // ── Auto-close if all confirmed players have now voted ────────────────────
  const { data: todosVotantes } = await admin
    .from('votos_reconocimiento')
    .select('votante_id')
    .eq('partido_id', partido_id as string)

  const uniqueVotantes = new Set((todosVotantes ?? []).map(v => v.votante_id)).size
  const totalConfirmados = confirmados?.length ?? 0

  if (uniqueVotantes >= totalConfirmados && totalConfirmados > 0) {
    await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', partido_id as string)
    const { badges_asignados } = await tallyAndAssign(admin, partido_id as string)
    // Recognitions are final — apply rating deltas (no-op if result not yet entered).
    try { await applyMatchRatings(admin, partido_id as string) } catch (e) { console.error('[rating] auto_cerrar:', e) }
    await logActivity({
      user_id: user.id,
      accion: 'auto_cerrar_votacion',
      detalles: { partido_id, razon: 'todos_votaron', badges_asignados },
    })
    return NextResponse.json({ ok: true, mensaje: '¡Votos enviados! Todos votaron — badges asignados.', auto_cerrado: true })
  }

  return NextResponse.json({ ok: true, mensaje: '¡Votos enviados! Gracias.' })
}

// ── PUT /api/evaluaciones — admin: close voting + assign badges ───────────────
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role, username, club_id').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin' && (prof as { role?: string })?.role !== 'superadmin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const clubId = (prof as { club_id?: string })?.club_id
  if (!clubId) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // The match must belong to this admin's club — otherwise an admin could close
  // another club's evaluaciones.
  const { data: pOwn } = await admin
    .from('partidos').select('id').eq('id', partido_id as string).eq('club_id', clubId).maybeSingle()
  if (!pOwn) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', partido_id as string).eq('club_id', clubId)
  const { badges_asignados, sin_quorum } = await tallyAndAssign(admin, partido_id as string)
  // Recognitions are final — apply rating deltas (no-op if result not yet entered).
  try { await applyMatchRatings(admin, partido_id as string) } catch (e) { console.error('[rating] cerrar_votacion:', e) }

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'cerrar_votacion',
    detalles: { partido_id, badges_asignados, sin_quorum },
  })

  return NextResponse.json({
    ok: true,
    mensaje: sin_quorum > 0
      ? `Votación cerrada. ${badges_asignados} reconocimientos asignados, ${sin_quorum} sin quórum.`
      : `Votación cerrada. ${badges_asignados} reconocimientos asignados.`,
    badges_asignados,
    sin_quorum,
  })
}

// ── PATCH /api/evaluaciones — admin: reopen voting + delete badges ────────────
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role, username, club_id').eq('id', user.id).single()
  if ((prof as { role?: string })?.role !== 'admin' && (prof as { role?: string })?.role !== 'superadmin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const clubId = (prof as { club_id?: string })?.club_id
  if (!clubId) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // Scope to this admin's club — reopening also deletes badges, so an unscoped
  // id would let one club destroy another's awarded badges.
  const { data: pOwn } = await admin
    .from('partidos').select('id').eq('id', partido_id as string).eq('club_id', clubId).maybeSingle()
  if (!pOwn) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  // ya_abiertas stops the cron from auto-reopening these once they're closed.
  await admin.from('partidos')
    .update({ evaluaciones_abiertas: true, evaluaciones_ya_abiertas: true })
    .eq('id', partido_id as string).eq('club_id', clubId)
  await admin.from('player_badges').delete().eq('partido_id', partido_id as string).eq('club_id', clubId)
  // Reabrir es empezar de cero: los vetos de admin también se van, si no
  // quedarían bloqueando a gente en una votación que aún no ha ocurrido.
  await admin.from('badges_revocados').delete().eq('partido_id', partido_id as string).eq('club_id', clubId)
  // Undo this match's rating deltas — they'll recompute when it's re-closed.
  try { await revertMatchRatings(admin, partido_id as string) } catch (e) { console.error('[rating] reabrir_votacion:', e) }

  await logActivity({
    user_id: user.id,
    username: (prof as { username?: string })?.username,
    accion: 'reabrir_votacion',
    detalles: { partido_id },
  })

  return NextResponse.json({ ok: true, mensaje: 'Evaluaciones reabiertas. Los badges previos de este partido fueron eliminados.' })
}

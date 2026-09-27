import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPush, isDeadPushError } from '@/lib/push'
import { calcularVentanaPartido, MIN_CONFIRMADOS_AUTO_JUGADO } from '@/lib/partidos'
import { programaApertura, programaRecordatorio } from '@/lib/notifHorario'
import { RECURRENCIA_KEY, parsePlantillas, fechasPorCrear, DIAS_SEMANA } from '@/lib/recurrencia'
import { abrirEvaluaciones, contarConfirmados } from '@/lib/partidoCierre'
import { ausenteEn, type Ausencia } from '@/lib/ausencia'
import { logActivity } from '@/lib/activityLog'
import { sendAperturaEmail, sendRecordatorioEmail, sendRecordatorioVotarEmail } from '@/lib/email'
import { tallyAndAssign } from '@/app/api/evaluaciones/route'
import { channelsFor } from '@/lib/notifications'
import { quorumDeSettings, HORA_RECORDATORIO_VOTAR } from '@/lib/reconocimientos'
import { applyMatchRatings } from '@/lib/rating'
import { notificarInvitadoConfirmado } from '@/lib/invitados'
import { generarBorradorAuto } from '@/lib/teamDraft'
import { notifyAdmins } from '@/lib/notifyAdmins'
import { parsePromoHour, horaColombia, fechaColombia } from '@/lib/promoHora'

// Every-minute cron metronome — pg_cron fires every minute, all timing logic lives here.
// Handles 5 tasks in one pass:
//   1. Apertura: fires 5 min before inscription window opens (or admin-set timestamp)
//   2. Día-antes reminder to confirmed players 1 day before match
//   3. Recordatorio: fires 9 hours before match (or admin-set timestamp) to confirmed players
//   4. Cupos disponibles push to non-inscribed club players
//   5. Drain notificaciones_pendientes (promotion emails/push)

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return false
  return true
}

async function sendToMany(
  admin: ReturnType<typeof createAdminClient>,
  subs: { endpoint: string; p256dh: string; auth: string }[],
  payload: { title: string; body: string; url?: string }
): Promise<number> {
  const results = await Promise.allSettled(
    subs.map(sub =>
      sendPush(sub, payload)
        .then(() => 1 as const)
        .catch(async (err: unknown) => {
          if (isDeadPushError(err)) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          } else {
            console.error('[cron/notificaciones] sendPush failed:', err)
          }
          return 0 as const
        })
    )
  )
  return results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0)
}

// ── Per-club helpers (cached within one cron run) ──────────────────────────
type AdminClient = ReturnType<typeof createAdminClient>
type Settings = Record<string, unknown>

async function getClubSettings(
  admin: AdminClient,
  clubId: string,
  cache: Map<string, Settings>
): Promise<Settings> {
  if (cache.has(clubId)) return cache.get(clubId)!
  const { data } = await admin.from('app_settings').select('key, value').eq('club_id', clubId)
  // Keep RAW values: booleans stay booleans, strings (e.g. hora_promo_invitados)
  // stay strings — the old `=== true` coercion destroyed string settings.
  const s: Settings = {}
  for (const row of data ?? []) s[(row as { key: string }).key] = (row as { value: unknown }).value
  cache.set(clubId, s)
  return s
}

type JugadorClub = { id: string } & Ausencia

/** Approved, unbanned players of a club, minus those marked absent on `fecha`. */
async function getClubPlayerIds(
  admin: AdminClient,
  clubId: string,
  cache: Map<string, JugadorClub[]>,
  fecha: string
): Promise<string[]> {
  if (!cache.has(clubId)) {
    const { data } = await admin
      .from('profiles')
      .select('id, ausente_desde, ausente_hasta')
      .eq('club_id', clubId)
      .eq('aprobado', true)
      .eq('baneado', false)
    cache.set(clubId, (data ?? []) as JugadorClub[])
  }
  return cache.get(clubId)!.filter(p => !ausenteEn(p, fecha)).map(p => p.id)
}

async function getClubNombreById(
  admin: AdminClient,
  clubId: string,
  cache: Map<string, string>
): Promise<string> {
  if (cache.has(clubId)) return cache.get(clubId)!
  const { data } = await admin.from('clubs').select('nombre').eq('id', clubId).single()
  const nombre = (data as { nombre?: string } | null)?.nombre ?? 'MBA Fútbol Club'
  cache.set(clubId, nombre)
  return nombre
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const now = new Date()
  // partidos.fecha is a Colombia calendar date, so every date compared against
  // it is computed in Colombia too. Using UTC here meant that from 19:00
  // Colombia onwards the date had already rolled over, and "mañana" pointed at
  // the day after tomorrow — the día-antes push went out a day early.
  const hoyCol = fechaColombia(now)
  const mananaCol = fechaColombia(new Date(now.getTime() + 86400000))

  const results = {
    apertura: 0, apertura_email: 0,
    dia_antes: 0,
    recordatorio: 0, recordatorio_email: 0,
    cupos: 0,
    invitados: 0,
    borradores: 0,
    recurrentes: 0,
    cierres_votacion: 0,
    liberados: 0,
    cierres: 0,
  }

  const settingsCache = new Map<string, Settings>()
  const playerIdsCache = new Map<string, JugadorClub[]>()
  const clubNombreCache = new Map<string, string>()

  // ── Partidos que se repiten cada semana ──────────────────────────────────
  // Se mantiene una ventana corta de partidos creados por delante (ver
  // lib/recurrencia). Va en try/catch a propósito: si algo falla acá, las
  // notificaciones del resto del cron tienen que salir igual.
  try {
    const { data: filasRec } = await admin
      .from('app_settings').select('club_id, value').eq('key', RECURRENCIA_KEY)

    for (const fila of (filasRec ?? []) as { club_id: string; value: unknown }[]) {
      const plantillas = parsePlantillas(fila.value)
      if (plantillas.length === 0) continue

      // Las fechas que ya tienen partido en este club, de hoy en adelante: con
      // eso se cuenta cuántos de la serie quedan vivos y se saltan repetidas.
      const { data: existentes } = await admin
        .from('partidos').select('fecha').eq('club_id', fila.club_id).gte('fecha', hoyCol)
      const ocupadas = new Set(((existentes ?? []) as { fecha: string }[]).map(r => r.fecha))

      const porCrear: Record<string, unknown>[] = []
      const actualizadas = plantillas.map(pl => {
        const fechas = fechasPorCrear(pl, hoyCol, ocupadas)
        if (fechas.length === 0) return pl
        for (const f of fechas) {
          porCrear.push({
            club_id: fila.club_id,
            fecha: f,
            dia_semana: DIAS_SEMANA[pl.dia],
            hora: pl.hora,
            cupos_total: pl.cupos,
            hora_apertura: pl.hora_apertura,
            dias_antes_apertura: pl.dias_antes,
            inscripcion_abierta: false,
            tipo: pl.tipo,
            ...(pl.lugar ? { lugar: pl.lugar } : {}),
          })
          // Se marca ocupada de una: dos plantillas del mismo día no pueden
          // crear el mismo partido dos veces en la misma pasada.
          ocupadas.add(f)
        }
        // Avanza hasta la última generada, aunque el bucle haya saltado fechas
        // viejas: así una serie que estuvo quieta no las revive nunca.
        return { ...pl, creado_hasta: fechas[fechas.length - 1] }
      })

      if (porCrear.length === 0) continue

      const { error: errIns } = await admin.from('partidos').insert(porCrear)
      if (errIns) {
        // Sin guardar `creado_hasta`: si no se creó el partido, la plantilla
        // tiene que volver a intentarlo en la próxima pasada.
        console.error('[cron] recurrencia insert', fila.club_id, errIns)
        continue
      }
      results.recurrentes += porCrear.length

      const { error: errSet } = await admin.from('app_settings').upsert({
        club_id: fila.club_id,
        key: RECURRENCIA_KEY,
        value: actualizadas,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'club_id,key' })
      // Si esto falla, los partidos quedaron creados pero `creado_hasta` sigue
      // atrás. No se duplica nada — la próxima pasada ve esas fechas ocupadas
      // y las salta — pero conviene verlo en los logs.
      if (errSet) console.error('[cron] recurrencia settings', fila.club_id, errSet)
    }
  } catch (e) {
    console.error('[cron] recurrencia:', e)
  }

  // ── Release expired bans ─────────────────────────────────────────────────
  // fecha_liberacion was only ever stored and displayed — nothing acted on it,
  // so a suspension outlived its own end date until an admin noticed by hand.
  {
    const { data: porLiberar } = await admin
      .from('profiles')
      .select('id, username, club_id, fecha_liberacion')
      .eq('baneado', true)
      .not('fecha_liberacion', 'is', null)
      .lte('fecha_liberacion', hoyCol)

    for (const p of porLiberar ?? []) {
      const { error } = await admin
        .from('profiles')
        .update({ baneado: false, fecha_ban: null, fecha_liberacion: null, razon_ban: null })
        .eq('id', (p as { id: string }).id)
      if (error) { console.error('[cron] liberar ban falló:', error.message); continue }
      results.liberados++
      await logActivity({
        club_id: (p as { club_id?: string }).club_id,
        accion: 'auto_liberar_ban',
        detalles: { player_id: (p as { id: string }).id, username: (p as { username?: string }).username, vencia: (p as { fecha_liberacion?: string }).fecha_liberacion },
      })
    }
  }

  // ── Auto-open/close evaluaciones ─────────────────────────────────────────
  const ayerStr = fechaColombia(new Date(now.getTime() - 86400000))

  // ── Match close-out: one hour after kickoff ──────────────────────────────
  // The match leaves the home screen and needs an answer to "¿se jugó?". A full
  // match (more than MIN_CONFIRMADOS_AUTO_JUGADO, guests included) is taken as
  // played: votes open straight away and admins are only asked for score and
  // photo. Anything smaller is the admins' call, so they get the question.
  {
    const { data: porCerrar, error: cierreErr } = await admin
      .from('partidos')
      .select('id, club_id, fecha, hora, dia_semana, jugado')
      .in('fecha', [ayerStr, hoyCol])
      .eq('cierre_procesado', false)
    if (cierreErr) console.error('[cron] cierre query FAILED:', cierreErr.message)

    type PorCerrar = { id: string; club_id: string; fecha: string; hora: string | null; dia_semana: string; jugado: boolean | null }
    for (const p of (porCerrar ?? []) as PorCerrar[]) {
      if (now < calcularVentanaPartido(p, now).termina) continue

      // Claim before anything slow — the cron ticks every minute.
      const { data: claim } = await admin.from('partidos')
        .update({ cierre_procesado: true })
        .eq('id', p.id).eq('cierre_procesado', false)
        .select('id')
      if (!claim?.length) continue
      results.cierres++

      // An admin already answered before the hour was up.
      if (p.jugado !== null) continue

      const confirmados = await contarConfirmados(admin, p.id)
      if (confirmados > MIN_CONFIRMADOS_AUTO_JUGADO) {
        await admin.from('partidos').update({ jugado: true }).eq('id', p.id).is('jugado', null)
        let pushEnviados = 0
        try { pushEnviados = (await abrirEvaluaciones(admin, p.id, p.club_id, { soloPrimeraVez: true })).push_enviados }
        catch (e) { console.error('[cron] abrirEvaluaciones (auto jugado):', e) }
        await logActivity({ club_id: p.club_id, accion: 'auto_partido_jugado', detalles: { partido_id: p.id, fecha: p.fecha, confirmados, push_enviados: pushEnviados } })
        await notifyAdmins(
          admin, p.club_id, 'cierre',
          `✅ Partido del ${p.dia_semana} jugado`,
          `Hubo ${confirmados} confirmados, así que lo marcamos como jugado y abrimos las votaciones. Falta el marcador y la foto.`
        )
      } else {
        await logActivity({ club_id: p.club_id, accion: 'cierre_pendiente', detalles: { partido_id: p.id, fecha: p.fecha, confirmados } })
        await notifyAdmins(
          admin, p.club_id, 'cierre',
          `⚽ ¿Se jugó el partido del ${p.dia_semana}?`,
          `Hubo ${confirmados} confirmados. Confírmalo y sube el marcador y la foto.`
        )
      }
    }
  }

  /**
   * Cierra la votación de un partido y deja todo aplicado.
   *
   * Los dos caminos que cierran (el plazo y el quórum completo) tienen que
   * hacer exactamente lo mismo: repartir reconocimientos y aplicar el rating.
   * Con dos copias, la primera vez que se toque una el otro camino empieza a
   * dejar partidos sin puntaje aplicado y nadie se entera.
   */
  const cerrarVotacion = async (
    partidoId: string, clubId: string | undefined, fecha: string, razon: 'plazo' | 'todos_votaron'
  ) => {
    // El update va condicionado a que siga abierta: si dos caminos coinciden en
    // el mismo tic, solo uno reparte reconocimientos.
    const { data: cerrado } = await admin
      .from('partidos')
      .update({ evaluaciones_abiertas: false })
      .eq('id', partidoId).eq('evaluaciones_abiertas', true)
      .select('id')
    if (!cerrado?.length) return

    const { badges_asignados } = await tallyAndAssign(admin, partidoId)
    // Los reconocimientos quedan finales: se aplica el rating (no hace nada si
    // el partido todavía no tiene marcador).
    try { await applyMatchRatings(admin, partidoId) } catch (e) { console.error('[rating] cron auto_cerrar:', e) }
    await logActivity({
      club_id: clubId, accion: 'auto_cerrar_evaluaciones',
      detalles: { partido_id: partidoId, fecha, razon, badges_asignados },
    })
    results.cierres_votacion++
  }

  const { data: pasados } = await admin
    .from('partidos')
    .select('id, club_id, fecha, hora, hora_apertura, dias_antes_apertura, jugado, evaluaciones_abiertas, evaluaciones_ya_abiertas')
    .in('fecha', [hoyCol, ayerStr])

  for (const p of pasados ?? []) {
    // Red de seguridad. Las votaciones abren en cuanto el partido se marca
    // jugado (por un admin, o por el cierre de arriba); esto atrapa un partido
    // jugado cuya apertura falló a medias. Nunca abre un partido sin responder,
    // y `evaluaciones_ya_abiertas` mantiene final el cierre de un admin.
    //
    // Corre el MISMO día del partido y ya no al día siguiente: desde que la
    // votación cierra a las 00:00 de D+1, abrirla en D+1 sería abrir algo que
    // el bloque de abajo cierra en el tic siguiente.
    if (
      p.fecha === hoyCol &&
      now >= calcularVentanaPartido(p as { fecha: string; hora?: string | null }, now).termina &&
      (p as { jugado?: boolean | null }).jugado === true &&
      !(p.evaluaciones_abiertas as boolean) &&
      !(p.evaluaciones_ya_abiertas as boolean)
    ) {
      const clubIdP = (p as { club_id: string }).club_id
      try {
        const r = await abrirEvaluaciones(admin, p.id, clubIdP, { soloPrimeraVez: true })
        if (r.abiertas) await logActivity({ club_id: clubIdP, accion: 'auto_abrir_evaluaciones', detalles: { partido_id: p.id, fecha: p.fecha, confirmados: r.jugadores } })
      } catch (e) {
        console.error('[cron] abrirEvaluaciones (red de seguridad):', e)
      }
    }
    // Cierre por plazo: a las 00:00 del día siguiente al partido, o sea que se
    // vota la misma noche (ver `cierreAutomatico` en lib/reconocimientos).
    //
    // La ventana horaria no es decorativa. Sin ella, un admin que marque el
    // partido como jugado al otro día abriría las votaciones y el cron se las
    // cerraría al minuto siguiente, dejando a todo el mundo sin votar. Con el
    // límite, después de las 6 AM el cron ya no cierra por plazo y esa votación
    // tardía alcanza a usarse. El cron corre cada minuto, así que seis horas
    // son de sobra para el caso normal.
    if (p.fecha === ayerStr && horaColombia(now) < 6 && (p.evaluaciones_abiertas as boolean)) {
      await cerrarVotacion(p.id, (p as { club_id?: string }).club_id, p.fecha, 'plazo')
    }
  }

  // ── Cierre anticipado: ya votaron todos ──────────────────────────────────
  // Si los confirmados ya entregaron su evaluación, esperar a medianoche no
  // agrega nada: no falta ningún voto por llegar. Se cierra de una y los
  // reconocimientos salen esa misma noche.
  //
  // Solo cuenta a los inscritos confirmados: los invitados no tienen cuenta y
  // por lo tanto no votan. Si no hay confirmados, no se cierra nada — un
  // partido sin gente no es un partido con quórum completo.
  // Solo el día del partido. Este bloque hace tres consultas por partido
  // abierto y el cron corre cada minuto: acotarlo a las ~4 horas de la ventana
  // real son ~700 consultas por partido, en vez de seguir sondeando todo el día
  // siguiente una votación que ya debería estar cerrada.
  for (const p of (pasados ?? []) as { id: string; club_id?: string; fecha: string; evaluaciones_abiertas: boolean }[]) {
    if (!p.evaluaciones_abiertas || p.fecha !== hoyCol) continue
    try {
      const [{ data: confirmados }, { data: votos }, { data: thumbs }] = await Promise.all([
        admin.from('inscripciones').select('player_id').eq('partido_id', p.id).eq('estado', 'confirmado'),
        admin.from('votos_reconocimiento').select('votante_id').eq('partido_id', p.id),
        admin.from('player_thumbs').select('votante_id').eq('partido_id', p.id),
      ])
      const ids = ((confirmados ?? []) as { player_id: string }[]).map(c => c.player_id)
      if (ids.length === 0) continue

      const votaron = new Set<string>()
      for (const v of [...(votos ?? []), ...(thumbs ?? [])] as { votante_id: string }[]) votaron.add(v.votante_id)

      if (ids.every(id => votaron.has(id))) {
        await cerrarVotacion(p.id, p.club_id, p.fecha, 'todos_votaron')
      }
    } catch (e) {
      console.error('[cron] cierre anticipado:', p.id, e)
    }
  }

  // ── Recordatorio de votación (10 PM del MISMO día del partido) ────────────
  // La ventana es corta a propósito: abren al terminar el partido (~8 PM) y el
  // cron las cierra a las 00:00. El recordatorio sale a las 10 PM, o sea dos
  // horas después de que abren y dos antes de que cierren.
  //
  // Solo sale si la votación TODAVÍA no llegó al quórum de votantes: si ya
  // alcanzó, los reconocimientos se van a repartir igual y nadie va a perder
  // puntaje, así que no hay por qué molestar a nadie.
  //
  // Todo el bloque va en try/catch: depende de partidos.notif_votar_sent
  // (20260919_recordatorio_votar.sql). Si la migración no ha corrido, esto no
  // manda nada y el resto del cron sigue igual, en vez de tumbarlo entero.
  if (horaColombia(now) === HORA_RECORDATORIO_VOTAR) {
    try {
      const { data: abiertos } = await admin
        .from('partidos')
        .select('id, club_id, fecha, dia_semana, notif_votar_sent')
        .eq('fecha', hoyCol)
        .eq('evaluaciones_abiertas', true)

      for (const p of (abiertos ?? []) as { id: string; club_id: string; fecha: string; dia_semana: string; notif_votar_sent: boolean }[]) {
        if (p.notif_votar_sent) continue

        const settings = await getClubSettings(admin, p.club_id, settingsCache)
        const ch = channelsFor(settings, 'recordatorio_votar')
        if (!ch.email && !ch.push) continue

        const [{ data: confirmados }, { data: votos }, { data: thumbs }] = await Promise.all([
          admin.from('inscripciones').select('player_id').eq('partido_id', p.id).eq('estado', 'confirmado'),
          admin.from('votos_reconocimiento').select('votante_id').eq('partido_id', p.id),
          admin.from('player_thumbs').select('votante_id').eq('partido_id', p.id),
        ])

        const yaVotaron = new Set<string>()
        for (const v of [...(votos ?? []), ...(thumbs ?? [])] as { votante_id: string }[]) yaVotaron.add(v.votante_id)

        // Si ya hay quórum, nadie va a perder puntaje: no se molesta a nadie.
        const { minVotantes } = quorumDeSettings(settings)
        if (yaVotaron.size >= minVotantes) {
          await admin.from('partidos').update({ notif_votar_sent: true }).eq('id', p.id)
          await logActivity({ club_id: p.club_id, accion: 'recordatorio_votar_omitido', detalles: { partido_id: p.id, votaron: yaVotaron.size, min: minVotantes } })
          continue
        }

        const faltan = ((confirmados ?? []) as { player_id: string }[])
          .map(c => c.player_id)
          .filter(id => !yaVotaron.has(id))
        if (faltan.length === 0) {
          await admin.from('partidos').update({ notif_votar_sent: true }).eq('id', p.id)
          continue
        }

        const clubNombre = await getClubNombreById(admin, p.club_id, clubNombreCache)
        let enviadosPush = 0, enviadosEmail = 0

        if (ch.push) {
          const { data: subs } = await admin
            .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', faltan)
          for (const sub of subs ?? []) {
            try {
              await sendPush(sub, {
                title: '⏰ Te faltan tus votos',
                body: `Evalúa el partido del ${p.dia_semana}. Cierran a medianoche, o pierdes 0.02 de puntaje.`,
                url: `/evaluar/${p.id}`,
              })
              enviadosPush++
            } catch (err) {
              if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
              else console.error('[cron] recordatorio_votar push:', err)
            }
          }
        }

        if (ch.email) {
          const { data: perfiles } = await admin
            .from('profiles').select('email, username').in('id', faltan)
          const res = await Promise.allSettled(
            ((perfiles ?? []) as { email: string | null; username: string }[])
              .filter(pr => pr.email)
              .map(pr => sendRecordatorioVotarEmail({
                email: pr.email!, username: pr.username,
                diaSemana: p.dia_semana, partidoId: p.id, clubNombre,
              }))
          )
          enviadosEmail = res.filter(r => r.status === 'fulfilled').length
        }

        await admin.from('partidos').update({ notif_votar_sent: true }).eq('id', p.id)
        await logActivity({
          club_id: p.club_id, accion: 'recordatorio_votar',
          detalles: { partido_id: p.id, faltaban: faltan.length, votaron: yaVotaron.size, push: enviadosPush, email: enviadosEmail },
        })
      }
    } catch (e) {
      console.error('[cron] recordatorio_votar (¿falta 20260919_recordatorio_votar.sql?):', e)
    }
  }

  // ── Apertura notifications ────────────────────────────────────────────────
  // Fires 5 minutes before the inscription window opens (or at admin-set
  // timestamp). El cálculo vive en lib/notifHorario, compartido con el panel:
  // la pantalla que le dice al admin cuándo sale el aviso tiene que usar la
  // misma cuenta que lo manda.

  const { data: aperturaCandidates } = await admin
    .from('partidos')
    .select('id, club_id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_apertura_at, tipo, lugar')
    .gte('fecha', hoyCol)
    .eq('notif_apertura_sent', false)
    .order('fecha', { ascending: true })
    .limit(20)

  const aperturaDue = (aperturaCandidates ?? []).filter(p => {
    const ts = (p as { notif_apertura_at?: string | null }).notif_apertura_at
    return now >= programaApertura(p, ts).cuando
  })

  for (const partido of aperturaDue) {
    const clubId = (partido as { club_id: string }).club_id
    const clubPlayerIds = await getClubPlayerIds(admin, clubId, playerIdsCache, partido.fecha)
    const clubNombre = await getClubNombreById(admin, clubId, clubNombreCache)
    const settings = await getClubSettings(admin, clubId, settingsCache)
    const ch = channelsFor(settings, 'apertura')
    const matchHora = partido.hora?.substring(0, 5) ?? '19:00'
    const lugar = (partido as { lugar?: string | null }).lugar
    const esMini = (partido as { tipo?: string }).tipo === 'minitorneo'
    const evento = esMini ? `Minitorneo del ${partido.dia_semana} 🏆` : `Partido del ${partido.dia_semana}`

    // Push → all club players
    if (ch.push) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('player_id', clubPlayerIds)

      results.apertura += await sendToMany(admin, subs ?? [], {
        title: '⚽ ¡Inscripciones abiertas!',
        body: `${evento}${lugar ? ` en 📍 ${lugar}` : ''}. ¡Corre a inscribirte!`,
        url: '/',
      })
    }

    // Email → approved club players
    if (ch.email) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('email, username, ausente_desde, ausente_hasta')
        .eq('club_id', clubId)
        .eq('aprobado', true)
        .eq('baneado', false)
        .neq('role', 'admin')
      const sent = await Promise.allSettled(
        (profiles ?? []).filter(p => !ausenteEn(p as Ausencia, partido.fecha)).map(p => sendAperturaEmail({
          email: (p as { email: string }).email,
          username: (p as { username: string }).username,
          diaSemana: partido.dia_semana,
          fechaPartido: partido.fecha,
          hora: matchHora,
          lugar,
          clubNombre,
        }))
      )
      results.apertura_email += sent.filter(r => r.status === 'fulfilled' && r.value.ok).length
    }

    await admin.from('partidos').update({ notif_apertura_sent: true }).eq('id', partido.id)

    // Close still-open evaluaciones from past matches
    const { data: evalAbiertas } = await admin
      .from('partidos')
      .select('id, fecha')
      .eq('club_id', clubId)
      .eq('evaluaciones_abiertas', true)
      .lt('fecha', hoyCol)
    for (const ep of evalAbiertas ?? []) {
      await admin.from('partidos').update({ evaluaciones_abiertas: false }).eq('id', ep.id)
      const { badges_asignados } = await tallyAndAssign(admin, ep.id)
      // Recognitions are final — apply rating deltas (no-op without a result).
      try { await applyMatchRatings(admin, ep.id) } catch (e) { console.error('[rating] cron auto_cerrar nueva_apertura:', e) }
      await logActivity({ club_id: clubId, accion: 'auto_cerrar_evaluaciones', detalles: { partido_id: ep.id, fecha: ep.fecha, razon: 'nueva_apertura', badges_asignados } })
    }
  }

  // ── Recordatorio notifications ────────────────────────────────────────────
  // Fires 9 hours before the match (or at admin-set timestamp). Ver la nota de
  // arriba: la cuenta es de lib/notifHorario.

  const { data: recordatorioCandidates } = await admin
    .from('partidos')
    .select('id, club_id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_recordatorio_at, tipo, lugar')
    .gte('fecha', hoyCol)
    .eq('notif_recordatorio_sent', false)
    .order('fecha', { ascending: true })
    .limit(20)

  const recordatorioDue = (recordatorioCandidates ?? []).filter(p => {
    const ts = (p as { notif_recordatorio_at?: string | null }).notif_recordatorio_at
    return now >= programaRecordatorio(p, ts).cuando
  })

  for (const partido of recordatorioDue) {
    const clubId = (partido as { club_id: string }).club_id
    const settings = await getClubSettings(admin, clubId, settingsCache)
    const ch = channelsFor(settings, 'recordatorio')
    const clubNombre = await getClubNombreById(admin, clubId, clubNombreCache)
    const matchHora = partido.hora?.substring(0, 5) ?? '19:00'

    const { data: inscripciones } = await admin
      .from('inscripciones')
      .select('player_id')
      .eq('partido_id', partido.id)
      .eq('estado', 'confirmado')

    const confirmedIds = (inscripciones ?? []).map((i: { player_id: string }) => i.player_id)
    if (confirmedIds.length > 0) {
      // Push
      if (ch.push) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', confirmedIds)

        const recLugar = (partido as { lugar?: string | null }).lugar
        const recMini = (partido as { tipo?: string }).tipo === 'minitorneo'
        results.recordatorio += await sendToMany(admin, subs ?? [], {
          title: recMini ? '🏆 Minitorneo hoy' : '⏰ Partido hoy',
          body: `Recuerda: ${recMini ? 'minitorneo' : 'partido'} del ${partido.dia_semana} a las ${matchHora}${recLugar ? ` en 📍 ${recLugar}` : ''}. ¡Nos vemos!`,
          url: '/',
        })
      }

      // Email
      if (ch.email) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('email, username')
          .in('id', confirmedIds)
        const sent = await Promise.allSettled(
          (profiles ?? []).map(p => sendRecordatorioEmail({
            email: (p as { email: string }).email,
            username: (p as { username: string }).username,
            diaSemana: partido.dia_semana,
            hora: matchHora,
            lugar: (partido as { lugar?: string | null }).lugar,
            clubNombre,
          }))
        )
        results.recordatorio_email += sent.filter(r => r.status === 'fulfilled' && r.value.ok).length
      }
    }

    await admin.from('partidos').update({ notif_recordatorio_sent: true }).eq('id', partido.id)
  }

  // ── Load upcoming partidos for remaining checks (dia_antes, cupos, invitados) ─
  const { data: partidos, error: partidosErr } = await admin
    .from('partidos')
    .select('id, club_id, fecha, dia_semana, hora, hora_apertura, dias_antes_apertura, notif_dia_antes_sent, notif_cupos_sent, cupos_total, evaluaciones_abiertas, equipos_confirmados, equipos_autogenerados, tipo, lugar')
    .gte('fecha', hoyCol)
    .order('fecha', { ascending: true })
    .limit(20)

  // Everything below — día-antes, cupos, guest promotion, auto-draft — depends
  // on this one query. It failed silently for months over a column that was
  // referenced in code but never migrated, so make it impossible to miss.
  if (partidosErr) {
    console.error('[cron] partidos query FAILED — día-antes, cupos, invitados y borrador NO corrieron:', partidosErr.message)
    // activity_log.club_id is NOT NULL, and this failure affects every club, so
    // record it against each one — otherwise the row is dropped and the outage
    // stays invisible in the panel, which is exactly how the last one hid.
    const { data: clubes } = await admin.from('clubs').select('id')
    for (const c of (clubes ?? []) as { id: string }[]) {
      await logActivity({ club_id: c.id, accion: 'cron_error', detalles: { paso: 'partidos_query', error: partidosErr.message } })
    }
  }

  for (const partido of partidos ?? []) {
    const clubId = (partido as { club_id: string }).club_id
    const { abierta } = calcularVentanaPartido(partido)
    const matchHora = partido.hora?.substring(0, 5) ?? '19:00'

    const settings = await getClubSettings(admin, clubId, settingsCache)
    const clubPlayerIds = await getClubPlayerIds(admin, clubId, playerIdsCache, partido.fecha)

    const sendDiaAntes  = settings['notif_dia_antes']  !== false
    const sendCupos     = settings['notif_cupos']      !== false
    // Promotion is an action, not a notification: gate it on the feature toggle.
    // It used to read notif_invitados — the *push* toggle for "Invitado
    // confirmado" — so muting that push silently stopped guests being promoted.
    const promoverInvitados = settings['usar_invitados'] !== false

    // ── Día antes: tomorrow's match, not yet notified ──────────────────────
    // With dias_antes_apertura = 1 the window opens the day before the match,
    // which is the same day this would fire. One announcement is enough.
    const aperturaMismoDia = ((partido as { dias_antes_apertura?: number }).dias_antes_apertura ?? 2) <= 1
    if (sendDiaAntes && !(partido as { notif_dia_antes_sent?: boolean }).notif_dia_antes_sent && partido.fecha === mananaCol && !aperturaMismoDia) {
      const { data: inscripciones } = await admin
        .from('inscripciones')
        .select('player_id')
        .eq('partido_id', partido.id)
        .eq('estado', 'confirmado')

      const confirmedIds = (inscripciones ?? []).map((i: { player_id: string }) => i.player_id)
      if (confirmedIds.length > 0) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', confirmedIds)

        const daLugar = (partido as { lugar?: string | null }).lugar
        results.dia_antes += await sendToMany(admin, subs ?? [], {
          title: '📅 Partido mañana',
          body: `Mañana a las ${matchHora} es el partido del ${partido.dia_semana}${daLugar ? ` en 📍 ${daLugar}` : ''}. ¿Vas a poder ir? Si no puedes, cancela tu cupo 🙏`,
          url: '/',
        })

        await admin.from('partidos').update({ notif_dia_antes_sent: true }).eq('id', partido.id)
      }
    }

    // ── Cupos disponibles — ONCE per partido, day-of, if still free ─────────
    // Guarded by notif_cupos_sent: cron runs every minute, without the flag this
    // push repeated per-minute while the window was open.
    const cuposSent = (partido as { notif_cupos_sent?: boolean }).notif_cupos_sent
    if (sendCupos && abierta && !cuposSent && partido.fecha === hoyCol) {
      const { count: confirmados } = await admin
        .from('inscripciones')
        .select('id', { count: 'exact', head: true })
        .eq('partido_id', partido.id)
        .eq('estado', 'confirmado')

      const cuposLibres = partido.cupos_total - (confirmados ?? 0)
      if (cuposLibres > 0) {
        const { data: inscritos } = await admin
          .from('inscripciones')
          .select('player_id')
          .eq('partido_id', partido.id)

        const inscritosIds = (inscritos ?? []).map((i: { player_id: string }) => i.player_id)

        // Push → club players NOT already on the list
        const subsQuery = admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .in('player_id', clubPlayerIds)

        const { data: subs } = inscritosIds.length > 0
          ? await (subsQuery as typeof subsQuery).not('player_id', 'in', `(${inscritosIds.join(',')})`)
          : await subsQuery

        results.cupos += await sendToMany(admin, subs ?? [], {
          title: '⚽ Cupos disponibles',
          body: `Quedan ${cuposLibres} cupo${cuposLibres !== 1 ? 's' : ''} para el partido del ${partido.dia_semana}. ¡Anótate antes de que se llene!`,
          url: '/',
        })
        await admin.from('partidos').update({ notif_cupos_sent: true }).eq('id', partido.id)
      }
    }

    // ── Invitee promotion: today's match, only from the club's promo hour ──
    // (default 2 PM Colombia; without this gate they promoted at midnight)
    const promoHour = parsePromoHour(settings['hora_promo_invitados'])
    const colHour = horaColombia(now)
    if (promoverInvitados && partido.fecha === hoyCol && colHour >= promoHour) {
      // Confirmed guests occupy spots too — counting only inscripciones let the
      // promotion overfill the match.
      const [{ count: confirmados }, { count: invConfirmados }] = await Promise.all([
        admin.from('inscripciones').select('id', { count: 'exact', head: true })
          .eq('partido_id', partido.id).eq('estado', 'confirmado'),
        admin.from('invitados').select('id', { count: 'exact', head: true })
          .eq('partido_id', partido.id).eq('estado', 'confirmado'),
      ])

      const cuposLibres = partido.cupos_total - (confirmados ?? 0) - (invConfirmados ?? 0)
      if (cuposLibres > 0) {
        const { data: invitadosPendientes } = await admin
          .from('invitados')
          .select('id')
          .eq('partido_id', partido.id)
          .eq('estado', 'espera')
          .order('posicion_espera', { ascending: true })
          .limit(cuposLibres)

        for (const inv of invitadosPendientes ?? []) {
          await admin.from('invitados')
            .update({ estado: 'confirmado', posicion_espera: null })
            .eq('id', inv.id)
          // Tell the guest (and whoever invited them) they're in.
          try { await notificarInvitadoConfirmado(admin, inv.id) }
          catch (e) { console.error('[cron] notificarInvitadoConfirmado:', e) }
          results.invitados++
        }
      }

      // ── Auto-draft the teams, once, after the guests are in ──────────────
      // Runs only if nobody has built teams yet: never overwrite an admin's work.
      const yaAutogenerado = (partido as { equipos_autogenerados?: boolean }).equipos_autogenerados
      if (!yaAutogenerado && !partido.equipos_confirmados) {
        const { count: yaHayEquipos } = await admin
          .from('equipos').select('id', { count: 'exact', head: true }).eq('partido_id', partido.id)

        if ((yaHayEquipos ?? 0) === 0) {
          // Claim it first — the cron ticks every minute and the draft takes
          // seconds (Gemini call), so a slow run would otherwise double-generate.
          await admin.from('partidos').update({ equipos_autogenerados: true }).eq('id', partido.id)
          try {
            const res = await generarBorradorAuto(admin, partido.id, clubId)
            if (res.ok) {
              results.borradores++
              await logActivity({
                club_id: clubId,
                accion: 'auto_borrador_equipos',
                detalles: { partido_id: partido.id, jugadores: res.jugadores, source: res.source },
              })
              await notifyAdmins(
                admin, clubId, 'equipos',
                '🧩 Borrador de equipos listo',
                `Se armaron los equipos del ${partido.dia_semana} con ${res.jugadores} jugadores. Revísalos y confírmalos.`
              )
              // Players see the suggestion and can say whether it looks even.
              const { data: confirmadosIns } = await admin
                .from('inscripciones').select('player_id')
                .eq('partido_id', partido.id).eq('estado', 'confirmado')
              const ids = (confirmadosIns ?? []).map((i: { player_id: string }) => i.player_id)
              if (ids.length) {
                const { data: subs } = await admin
                  .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', ids)
                await sendToMany(admin, subs ?? [], {
                  title: '🧩 Alineación sugerida',
                  body: `Ya está la alineación del ${partido.dia_semana}. Míralo y dinos si te parece pareja.`,
                  url: '/',
                })
              }
            } else {
              console.error('[cron] auto_borrador falló:', res.error)
            }
          } catch (e) {
            console.error('[cron] generarBorradorAuto:', e)
          }
        }
      }
    }
  }

  // ── Drain notificaciones_pendientes (promotion emails/push) ──────────────
  const { data: pendientes } = await admin
    .from('notificaciones_pendientes')
    .select('id, player_id, email, username, fecha_partido, club_id')
    .eq('enviado', false)
    .order('created_at', { ascending: true })
    .limit(20)

  let promovidos_enviados = 0
  for (const notif of pendientes ?? []) {
    try {
      const fecha = new Date(notif.fecha_partido + 'T12:00:00')
      const diaSemana = fecha.toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' })
      const fechaFormateada = fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' })
      const { sendPromovido } = await import('@/lib/email')
      const notifClubId = (notif as Record<string, unknown>).club_id as string | undefined
      const notifClubNombre = notifClubId ? await getClubNombreById(admin, notifClubId, clubNombreCache) : 'MBA Fútbol Club'
      const emailResult = await sendPromovido({ email: notif.email, username: notif.username, fechaPartido: fechaFormateada, diaSemana, clubNombre: notifClubNombre })
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('player_id', notif.player_id)
      for (const sub of subs ?? []) {
        try {
          await sendPush(sub, { title: '¡Entraste al partido!', body: `Cupo confirmado para el ${diaSemana} ${fechaFormateada} ⚽`, url: '/' })
        } catch (err) {
          if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
      }
      await admin.from('notificaciones_pendientes').update({ enviado: true }).eq('id', notif.id)
      await logActivity({ user_id: notif.player_id, username: notif.username, accion: 'notif_promovido', detalles: { email: notif.email, email_ok: emailResult.ok, fecha_partido: notif.fecha_partido, via: 'cron' } })
      promovidos_enviados++
    } catch (err) {
      console.error('[cron] error draining notif', notif.id, err)
    }
  }

  const totalPush = results.apertura + results.dia_antes + results.recordatorio + results.cupos
  const totalEmail = results.apertura_email + results.recordatorio_email
  // Deliberately console-only: this summary spans every club, and activity_log
  // requires a club_id. Per-club events above are the ones that get recorded.
  console.log('[cron/notificaciones]', now.toISOString(), { ...results, promovidos_enviados, totalPush, totalEmail })
  return NextResponse.json({ ok: true, ...results, promovidos_enviados })
}

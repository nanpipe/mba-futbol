import type { createAdminClient } from '@/lib/supabase/admin'
import { notifyAdmins } from '@/lib/notifyAdmins'

// ── Mantener la alineación al día cuando alguien sale del partido ────────────
//
// Los equipos se guardan por JUGADOR (`equipo_jugadores.player_id`), no por
// inscripción. Así que cuando alguien se bajaba con los equipos ya armados, el
// sistema subía al primero de la lista de espera pero no tocaba la alineación:
// el que se fue SEGUÍA apareciendo en su equipo, el que entró no aparecía en
// ninguno, y nadie se enteraba del cambio salvo los admins en el resumen.
//
// Esto lo corrige solo, jugador por jugador: el que entra ocupa el lugar exacto
// del que sale — mismo equipo, mismo puesto en la rotación de banca y de
// portero. NO reequilibra: si sale uno bueno y entra uno flojo, el partido queda
// desbalanceado y eso lo arregla un admin a mano. Es a propósito; un sistema
// que reacomoda equipos por su cuenta a dos horas del partido es peor que uno
// que solo hace el cambio obvio.
//
// No guarda estado: compara la alineación con la lista de confirmados de AHORA.
// Por eso da igual por qué camino salió alguien (se bajó, lo removió un admin,
// lo pasaron a espera) y da igual cómo elige el sistema al que sube. Correrla
// dos veces seguidas no cambia nada la segunda vez.

type Admin = ReturnType<typeof createAdminClient>

export interface EquipoAlineacion {
  id: string
  color: string | null
  portero_fijo: boolean | null
  /** Username, pese al nombre de la columna. */
  portero_fijo_id: string | null
  rotacion_banca: string[] | null
  rotacion_portero: string[] | null
}

export interface Miembro { player_id: string; equipo_id: string; username: string }
export interface Confirmado { player_id: string; username: string }

export interface Cambio {
  equipo_id: string
  color: string
  sale: string            // username
  entra: string | null    // username, o null si no hubo reemplazo
  eraPorteroFijo: boolean
}

export interface PlanAlineacion {
  /** Filas de equipo_jugadores a borrar. */
  borrar: { player_id: string; equipo_id: string }[]
  /** Filas de equipo_jugadores a crear. */
  agregar: { player_id: string; equipo_id: string; username: string }[]
  /** Cómo quedan las columnas de rotación de cada equipo que cambió. */
  equipos: Map<string, Pick<EquipoAlineacion, 'portero_fijo' | 'portero_fijo_id' | 'rotacion_banca' | 'rotacion_portero'>>
  cambios: Cambio[]
  /** Confirmados que no reemplazan a nadie (entraron con cupo libre). */
  sueltos: { username: string; equipo_id: string; color: string }[]
}

const COLOR_LABEL: Record<string, string> = { blanco: 'Blanco', negro: 'Negro', morado: 'Morado' }
export const nombreColor = (c: string | null) => (c && COLOR_LABEL[c]) || 'su equipo'

/**
 * Calcula qué cambiar. Pura: no toca la base, así se puede probar sola.
 *
 * `confirmados` va en el orden en que se inscribieron: si salen dos y entran
 * dos a la vez, el primero de la lista de espera toma el primer lugar libre.
 */
export function planearAlineacion(
  equipos: EquipoAlineacion[],
  miembros: Miembro[],
  confirmados: Confirmado[]
): PlanAlineacion {
  const confirmadoId = new Set(confirmados.map(c => c.player_id))
  const enEquipo = new Set(miembros.map(m => m.player_id))
  const porId = new Map(equipos.map(e => [e.id, e]))

  // Los que siguen en un equipo pero ya no están confirmados.
  const salen = miembros.filter(m => !confirmadoId.has(m.player_id) && porId.has(m.equipo_id))
  // Los confirmados que no están en ningún equipo.
  const entran = confirmados.filter(c => !enEquipo.has(c.player_id))

  const plan: PlanAlineacion = { borrar: [], agregar: [], equipos: new Map(), cambios: [], sueltos: [] }
  if (salen.length === 0 && entran.length === 0) return plan

  // Copias de trabajo de las rotaciones, solo de los equipos que se tocan.
  const trabajo = (equipoId: string) => {
    let t = plan.equipos.get(equipoId)
    if (!t) {
      const e = porId.get(equipoId)!
      t = {
        portero_fijo: e.portero_fijo,
        portero_fijo_id: e.portero_fijo_id,
        rotacion_banca: [...(e.rotacion_banca ?? [])],
        rotacion_portero: [...(e.rotacion_portero ?? [])],
      }
      plan.equipos.set(equipoId, t)
    }
    return t
  }

  // Tamaño de cada equipo, para mandar a los que entran sin reemplazar a nadie
  // al equipo que quedó con menos gente.
  const tam = new Map<string, number>()
  for (const e of equipos) tam.set(e.id, 0)
  for (const m of miembros) if (porId.has(m.equipo_id)) tam.set(m.equipo_id, (tam.get(m.equipo_id) ?? 0) + 1)

  const cola = [...entran]

  for (const s of salen) {
    const e = porId.get(s.equipo_id)!
    const t = trabajo(s.equipo_id)
    const r = cola.shift() ?? null
    plan.borrar.push({ player_id: s.player_id, equipo_id: s.equipo_id })
    tam.set(s.equipo_id, (tam.get(s.equipo_id) ?? 1) - 1)

    const eraPorteroFijo = !!t.portero_fijo && t.portero_fijo_id === s.username

    if (r) {
      plan.agregar.push({ player_id: r.player_id, equipo_id: s.equipo_id, username: r.username })
      tam.set(s.equipo_id, (tam.get(s.equipo_id) ?? 0) + 1)
      // Ocupa el mismo puesto en cada rotación: si el que salía iba tercero a
      // la banca, el que entra va tercero.
      t.rotacion_banca = (t.rotacion_banca ?? []).map(u => (u === s.username ? r.username : u))
      t.rotacion_portero = (t.rotacion_portero ?? []).map(u => (u === s.username ? r.username : u))
    } else {
      t.rotacion_banca = (t.rotacion_banca ?? []).filter(u => u !== s.username)
      t.rotacion_portero = (t.rotacion_portero ?? []).filter(u => u !== s.username)
    }

    // Se fue el portero fijo. El que entra no tiene por qué ser portero, así
    // que el equipo pasa a rotar el arco, y el que entra (que no estaba en la
    // banca, porque el fijo no rota) se suma al final de la banca.
    if (eraPorteroFijo) {
      t.portero_fijo = false
      t.portero_fijo_id = null
      if (r && !(t.rotacion_banca ?? []).includes(r.username)) {
        t.rotacion_banca = [...(t.rotacion_banca ?? []), r.username]
      }
    }

    plan.cambios.push({
      equipo_id: s.equipo_id,
      color: nombreColor(e.color),
      sale: s.username,
      entra: r?.username ?? null,
      eraPorteroFijo,
    })
  }

  // Confirmados de sobra: entraron con un cupo que estaba libre, no en lugar
  // de alguien. Van al equipo más corto, al final de la banca.
  for (const r of cola) {
    const destino = [...equipos].sort((a, b) => (tam.get(a.id) ?? 0) - (tam.get(b.id) ?? 0))[0]
    if (!destino) break
    plan.agregar.push({ player_id: r.player_id, equipo_id: destino.id, username: r.username })
    tam.set(destino.id, (tam.get(destino.id) ?? 0) + 1)
    const t = trabajo(destino.id)
    if (!(t.rotacion_banca ?? []).includes(r.username)) t.rotacion_banca = [...(t.rotacion_banca ?? []), r.username]
    plan.sueltos.push({ username: r.username, equipo_id: destino.id, color: nombreColor(destino.color) })
  }

  return plan
}

/** El texto del aviso a los jugadores. */
export function textoCambios(plan: PlanAlineacion, tamFinal: Map<string, number>): string[] {
  const lineas: string[] = []
  for (const c of plan.cambios) {
    lineas.push(c.entra
      ? `${c.color}: sale ${c.sale}, entra ${c.entra}.`
      : `${c.color}: sale ${c.sale}, no hay reemplazo — juegan con ${tamFinal.get(c.equipo_id) ?? '?'}.`)
  }
  for (const s of plan.sueltos) lineas.push(`${s.color}: entra ${s.username}.`)
  return lineas
}

/**
 * Pone la alineación de un partido al día con la lista de confirmados, y avisa.
 *
 * Se llama después de cualquier cosa que saque a alguien de los confirmados.
 * Nunca lanza: un aviso que falla no puede hacer fallar la baja de alguien.
 */
export async function sincronizarAlineacion(
  admin: Admin,
  partidoId: string,
  clubId: string
): Promise<{ cambios: number }> {
  try {
    const { data: equiposRows } = await admin
      .from('equipos')
      .select('id, color, portero_fijo, portero_fijo_id, rotacion_banca, rotacion_portero')
      .eq('partido_id', partidoId)
      .eq('club_id', clubId)
    const equipos = (equiposRows ?? []) as EquipoAlineacion[]
    if (equipos.length === 0) return { cambios: 0 }   // todavía no hay equipos: nada que mantener

    const [{ data: miembrosRows }, { data: insRows }, { data: partido }] = await Promise.all([
      admin.from('equipo_jugadores')
        .select('player_id, equipo_id, profiles(username)')
        .in('equipo_id', equipos.map(e => e.id)),
      admin.from('inscripciones')
        .select('player_id, created_at, profiles!player_id(username)')
        .eq('partido_id', partidoId)
        .eq('estado', 'confirmado')
        .order('created_at', { ascending: true }),
      admin.from('partidos').select('dia_semana, equipos_confirmados').eq('id', partidoId).maybeSingle(),
    ])

    const nombre = (p: unknown) => {
      const x = Array.isArray(p) ? p[0] : p
      return (x as { username?: string } | null)?.username ?? ''
    }
    const miembros: Miembro[] = ((miembrosRows ?? []) as { player_id: string; equipo_id: string; profiles: unknown }[])
      .map(m => ({ player_id: m.player_id, equipo_id: m.equipo_id, username: nombre(m.profiles) }))
    const confirmados: Confirmado[] = ((insRows ?? []) as { player_id: string; profiles: unknown }[])
      .map(c => ({ player_id: c.player_id, username: nombre(c.profiles) }))

    const plan = planearAlineacion(equipos, miembros, confirmados)
    if (plan.borrar.length === 0 && plan.agregar.length === 0) return { cambios: 0 }

    for (const b of plan.borrar) {
      await admin.from('equipo_jugadores').delete()
        .eq('equipo_id', b.equipo_id).eq('player_id', b.player_id)
    }
    if (plan.agregar.length) {
      // upsert por la UNIQUE(equipo_id, player_id): si dos bajas casi
      // simultáneas calculan lo mismo, la segunda no duplica la fila.
      await admin.from('equipo_jugadores').upsert(
        plan.agregar.map(a => ({ club_id: clubId, equipo_id: a.equipo_id, player_id: a.player_id })),
        { onConflict: 'equipo_id,player_id', ignoreDuplicates: true }
      )
    }
    for (const [id, cols] of plan.equipos) {
      await admin.from('equipos').update(cols).eq('id', id).eq('club_id', clubId)
    }

    // Tamaño final por equipo, para el aviso de "juegan con 6".
    const tamFinal = new Map<string, number>()
    for (const m of miembros) tamFinal.set(m.equipo_id, (tamFinal.get(m.equipo_id) ?? 0) + 1)
    for (const b of plan.borrar) tamFinal.set(b.equipo_id, (tamFinal.get(b.equipo_id) ?? 1) - 1)
    for (const a of plan.agregar) tamFinal.set(a.equipo_id, (tamFinal.get(a.equipo_id) ?? 0) + 1)

    const lineas = textoCambios(plan, tamFinal)
    const p = partido as { dia_semana?: string; equipos_confirmados?: boolean } | null
    const dia = p?.dia_semana ? ` del ${p.dia_semana}` : ''

    // A los jugadores solo se les avisa si la alineación ya estaba publicada.
    // Con un borrador nadie la ha visto todavía: se corrige en silencio y el
    // aviso de siempre sale cuando un admin la confirme.
    if (p?.equipos_confirmados) {
      const destinatarios = [
        ...new Set([
          ...miembros.filter(m => !plan.borrar.some(b => b.player_id === m.player_id)).map(m => m.player_id),
          ...plan.agregar.map(a => a.player_id),
        ]),
      ]
      await avisarJugadores(admin, destinatarios, `🔄 Cambio en la alineación${dia}`, lineas.join(' '))
    }

    // A los admins ya les llega el aviso de cada baja (con quién subió), así
    // que acá solo se les escribe si hay algo que decidir: se fue un portero
    // fijo, o un equipo quedó corto.
    const porteros = plan.cambios.filter(c => c.eraPorteroFijo)
    const cortos = plan.cambios.filter(c => !c.entra)
    if (porteros.length || cortos.length) {
      const partes: string[] = []
      if (porteros.length) partes.push(`${porteros.map(c => `${c.sale} era el portero fijo de ${c.color}`).join(' y ')}: ese equipo pasó a rotar el arco.`)
      if (cortos.length) partes.push(`${cortos.map(c => c.color).join(' y ')} quedó con uno menos, sin reemplazo.`)
      await notifyAdmins(admin, clubId, 'baja', `🔄 Revisa la alineación${dia}`, partes.join(' '))
    }

    return { cambios: plan.cambios.length + plan.sueltos.length }
  } catch (e) {
    console.error('[alineacion] sincronizar:', partidoId, e)
    return { cambios: 0 }
  }
}

async function avisarJugadores(admin: Admin, playerIds: string[], title: string, body: string) {
  if (playerIds.length === 0) return
  const { sendPush, isDeadPushError } = await import('@/lib/push')
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('player_id', playerIds)
  // En paralelo: esto corre dentro de la petición del que se está bajando, y
  // catorce envíos en fila le harían esperar varios segundos a que responda.
  await Promise.allSettled(
    ((subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]).map(async sub => {
      try {
        await sendPush(sub, { title, body, url: '/' })
      } catch (err) {
        if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        else console.error('[alineacion] push:', err)
      }
    })
  )
}

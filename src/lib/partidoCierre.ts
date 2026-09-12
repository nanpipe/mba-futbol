// Closing out a match: "was it played?", the score, and opening evaluaciones.
// Shared by the admin panel (explicit answer) and the cron (auto-mark when the
// match was clearly full), so both paths open votes and notify the same way.

import type { createAdminClient } from '@/lib/supabase/admin'
import { channelsFor } from '@/lib/notifications'
import { sendPush, isDeadPushError } from '@/lib/push'
import { sendEvaluacionesEmail } from '@/lib/email'
import { applyMatchRatings, revertMatchRatings } from '@/lib/rating'

type AdminClient = ReturnType<typeof createAdminClient>

/** Confirmed players plus confirmed guests — everyone who was down to play. */
export async function contarConfirmados(admin: AdminClient, partidoId: string): Promise<number> {
  const [{ count: ins }, { count: inv }] = await Promise.all([
    admin.from('inscripciones').select('id', { count: 'exact', head: true })
      .eq('partido_id', partidoId).eq('estado', 'confirmado'),
    admin.from('invitados').select('id', { count: 'exact', head: true })
      .eq('partido_id', partidoId).eq('estado', 'confirmado'),
  ])
  return (ins ?? 0) + (inv ?? 0)
}

/**
 * Open evaluaciones and notify the confirmed players.
 *
 * `soloPrimeraVez` makes it a claim: it only opens (and only notifies) if they
 * were never opened before. That keeps the cron and an admin tapping "Sí, se
 * jugó" at the same moment from pushing everyone twice, and never reopens a
 * vote an admin already closed. Without it this is the manual "reopen" button.
 */
export async function abrirEvaluaciones(
  admin: AdminClient,
  partidoId: string,
  clubId: string,
  opts: { soloPrimeraVez?: boolean } = {}
): Promise<{ abiertas: boolean; push_enviados: number; jugadores: number }> {
  let q = admin.from('partidos')
    .update({ evaluaciones_abiertas: true, evaluaciones_ya_abiertas: true })
    .eq('id', partidoId).eq('club_id', clubId)
  if (opts.soloPrimeraVez) q = q.eq('evaluaciones_ya_abiertas', false)
  const { data: abiertos, error } = await q.select('id, dia_semana')
  if (error) throw new Error(error.message)
  if (!abiertos || abiertos.length === 0) return { abiertas: false, push_enviados: 0, jugadores: 0 }

  const diaSemana = (abiertos[0] as { dia_semana?: string }).dia_semana ?? ''

  const { data: ins } = await admin
    .from('inscripciones').select('player_id')
    .eq('partido_id', partidoId).eq('estado', 'confirmado')
  const playerIds = (ins ?? []).map((i: { player_id: string }) => i.player_id)
  if (playerIds.length === 0) return { abiertas: true, push_enviados: 0, jugadores: 0 }

  const { data: sRows } = await admin.from('app_settings').select('key, value').eq('club_id', clubId)
  const settings: Record<string, unknown> = {}
  for (const r of (sRows ?? []) as { key: string; value: unknown }[]) settings[r.key] = r.value
  const ch = channelsFor(settings, 'evaluaciones')

  let pushEnviados = 0
  if (ch.push) {
    const { data: subs } = await admin
      .from('push_subscriptions').select('endpoint, p256dh, auth').in('player_id', playerIds)
    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, {
          title: '📊 ¿Cómo jugaron?',
          body: 'Las evaluaciones del partido están abiertas. Evalúa a tus compañeros.',
          url: `/evaluar/${partidoId}`,
        })
        pushEnviados++
      } catch (err) {
        if (isDeadPushError(err)) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        else console.error('[partidoCierre] sendPush failed:', err)
      }
    }
  }

  if (ch.email) {
    const { data: perfiles } = await admin.from('profiles').select('email, username').in('id', playerIds)
    for (const p of (perfiles ?? []) as { email?: string; username?: string }[]) {
      if (!p.email) continue
      try {
        await sendEvaluacionesEmail({ email: p.email, username: p.username ?? '', diaSemana, partidoId })
      } catch (err) {
        console.error('[partidoCierre] sendEvaluacionesEmail failed:', err)
      }
    }
  }

  return { abiertas: true, push_enviados: pushEnviados, jugadores: playerIds.length }
}

export interface ResultadoInput {
  goles_a?: unknown
  goles_b?: unknown
  puntos_blanco?: unknown
  puntos_negro?: unknown
  puntos_morado?: unknown
}

const toInt = (v: unknown) => (typeof v === 'number' ? v : parseInt(String(v), 10))

/** True when the body carries a score at all (the card lets admins skip it). */
export function traeResultado(b: ResultadoInput): boolean {
  const vacio = (v: unknown) => v === undefined || v === null || v === ''
  return !vacio(b.goles_a) || !vacio(b.goles_b) || !vacio(b.puntos_blanco) || !vacio(b.puntos_negro) || !vacio(b.puntos_morado)
}

/**
 * Validate and store the score (goals, or points for a minitorneo), then
 * recompute this match's rating deltas. Rating is secondary — never fails the save.
 */
export async function guardarResultado(
  admin: AdminClient,
  partidoId: string,
  clubId: string,
  input: ResultadoInput
): Promise<{ ok: true; resultado: string; mensaje: string; detalles: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const { data: pInfo } = await admin.from('partidos').select('tipo').eq('id', partidoId).eq('club_id', clubId).maybeSingle()
  if (!pInfo) return { ok: false, status: 404, error: 'Partido no encontrado' }
  const esMinitorneo = (pInfo as { tipo?: string }).tipo === 'minitorneo'

  let update: Record<string, unknown>
  let resultado: string
  let mensaje: string
  let detalles: Record<string, unknown>

  if (esMinitorneo) {
    const pB = toInt(input.puntos_blanco), pN = toInt(input.puntos_negro), pM = toInt(input.puntos_morado)
    if ([pB, pN, pM].some(p => isNaN(p) || p < 0 || p > 999)) return { ok: false, status: 400, error: 'Puntos inválidos' }

    const maxPts = Math.max(pB, pN, pM)
    const ganador = pB === maxPts && pB > pN && pB > pM ? 'blanco'
      : pN === maxPts && pN > pB && pN > pM ? 'negro'
      : pM === maxPts && pM > pB && pM > pN ? 'morado'
      : 'empate'

    resultado = `B${pB}-N${pN}-M${pM}`
    update = { resultado, puntos_blanco: pB, puntos_negro: pN, puntos_morado: pM }
    mensaje = `Resultado minitorneo: ${resultado} — Ganó ${ganador}`
    detalles = { resultado, ganador, tipo: 'minitorneo' }
  } else {
    const gA = toInt(input.goles_a), gB = toInt(input.goles_b)
    if (isNaN(gA) || isNaN(gB) || gA < 0 || gB < 0 || gA > 999 || gB > 999) return { ok: false, status: 400, error: 'Goles inválidos' }
    resultado = `${gA}-${gB}`
    update = { resultado, goles_a: gA, goles_b: gB }
    mensaje = `Resultado registrado: ${resultado}`
    detalles = { resultado, goles_a: gA, goles_b: gB }
  }

  const { error } = await admin.from('partidos').update(update).eq('id', partidoId).eq('club_id', clubId)
  if (error) return { ok: false, status: 500, error: 'Error guardando el resultado' }

  // No-op while evaluaciones are open; they apply when the vote closes.
  try { await revertMatchRatings(admin, partidoId); await applyMatchRatings(admin, partidoId) }
  catch (e) { console.error('[rating] guardarResultado:', e) }

  return { ok: true, resultado, mensaje, detalles }
}

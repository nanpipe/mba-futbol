// ── Notification events & channels ──────────────────────────────────────────
// Single source of truth for which notifications exist, who they go to, and the
// per-channel (email / push) on-off settings. Superadmin edits the channels in
// the admin panel; every send site reads channelsFor() before sending.
//
// Admin-audience events that can fire many times in a short span (signup,
// inscripción, baja) are BATCHED: queued to notif_digest and flushed by cron as
// a single summary, instead of one message per event.

export interface NotifEvent {
  key: string
  label: string
  desc: string
  audience: 'admin' | 'player'
  emailKey: string
  pushKey: string
  emailDefault: boolean
  pushDefault: boolean
  /** Batch into a periodic digest instead of sending immediately. */
  batch: boolean
}

export const NOTIF_EVENTS: NotifEvent[] = [
  // ── Admin alerts (high-frequency → batched, email OFF by default) ──
  { key: 'signup',       label: 'Nuevo registro',          desc: 'Un jugador solicita acceso al club',         audience: 'admin',  emailKey: 'signup_email',       pushKey: 'signup_push',       emailDefault: false, pushDefault: true,  batch: true },
  { key: 'inscripcion',  label: 'Inscripción a partido',   desc: 'Un jugador se anota a un partido',            audience: 'admin',  emailKey: 'inscripcion_email',  pushKey: 'inscripcion_push',  emailDefault: false, pushDefault: true,  batch: true },
  { key: 'baja',         label: 'Baja de partido',         desc: 'Un jugador se retira de un partido',          audience: 'admin',  emailKey: 'baja_email',         pushKey: 'baja_push',         emailDefault: false, pushDefault: true,  batch: true },
  // ── Player events (low-frequency → immediate) ──
  { key: 'apertura',     label: 'Inscripciones abiertas',  desc: 'Se abre la ventana de inscripción',           audience: 'player', emailKey: 'email_apertura',     pushKey: 'notif_apertura',     emailDefault: true,  pushDefault: true,  batch: false },
  { key: 'recordatorio', label: 'Recordatorio de partido', desc: 'A confirmados antes del partido',             audience: 'player', emailKey: 'email_recordatorio', pushKey: 'notif_recordatorio', emailDefault: true,  pushDefault: true,  batch: false },
  { key: 'cupos',        label: 'Cupos disponibles',       desc: 'A no-inscritos cuando quedan cupos',          audience: 'player', emailKey: 'cupos_email',        pushKey: 'notif_cupos',        emailDefault: false, pushDefault: true,  batch: false },
  { key: 'invitado',     label: 'Invitado confirmado',     desc: 'Al jugador cuando entra su invitado',         audience: 'player', emailKey: 'invitado_email',     pushKey: 'notif_invitados',    emailDefault: false, pushDefault: true,  batch: false },
  { key: 'promovido',    label: 'Promovido de espera',     desc: 'Al jugador que pasa de espera a confirmado',  audience: 'player', emailKey: 'promovido_email',    pushKey: 'promovido_push',     emailDefault: true,  pushDefault: true,  batch: false },
  { key: 'equipos',      label: 'Equipos confirmados',     desc: 'A los jugadores cuando se arman equipos',     audience: 'player', emailKey: 'equipos_email',      pushKey: 'equipos_push',       emailDefault: true,  pushDefault: true,  batch: false },
  { key: 'evaluaciones', label: 'Evaluaciones abiertas',   desc: 'A confirmados para votar tras el partido',    audience: 'player', emailKey: 'evaluaciones_email', pushKey: 'evaluaciones_push',  emailDefault: false, pushDefault: true,  batch: false },
]

const EVENT_BY_KEY: Record<string, NotifEvent> = Object.fromEntries(NOTIF_EVENTS.map(e => [e.key, e]))

/** Every settings key this module reads/writes (for guardar_setting allow-list). */
export const NOTIF_CHANNEL_KEYS: string[] = NOTIF_EVENTS.flatMap(e => [e.emailKey, e.pushKey])

/** Resolve a boolean setting that may be missing → use the event default. */
function flag(settings: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = settings[key]
  if (v === true || v === false) return v
  if (v === 'true') return true
  if (v === 'false') return false
  return def
}

/** Channels enabled for an event, honoring club settings + defaults. */
export function channelsFor(settings: Record<string, unknown>, eventKey: string): { email: boolean; push: boolean } {
  const e = EVENT_BY_KEY[eventKey]
  if (!e) return { email: false, push: false }
  return {
    email: flag(settings, e.emailKey, e.emailDefault),
    push: flag(settings, e.pushKey, e.pushDefault),
  }
}

export function isBatched(eventKey: string): boolean {
  return EVENT_BY_KEY[eventKey]?.batch ?? false
}

// Flush a club's digest when the oldest pending item is older than this, OR when
// the queue reaches the size threshold — whichever comes first.
export const DIGEST_MAX_AGE_MS = 10 * 60 * 1000 // 10 min
export const DIGEST_SIZE_THRESHOLD = 10

import type { createAdminClient } from '@/lib/supabase/admin'
type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Queue an admin-alert event for the periodic digest instead of sending now.
 * Best-effort: never throws (a failed enqueue must not block the user action).
 */
export async function enqueueDigest(
  admin: AdminClient,
  clubId: string,
  evento: string,
  mensaje: string
): Promise<void> {
  try {
    const { error } = await admin.from('notif_digest').insert({ club_id: clubId, evento, mensaje })
    if (error) console.error('[notif_digest] enqueue failed:', error)
  } catch (err) {
    console.error('[notif_digest] enqueue threw:', err)
  }
}

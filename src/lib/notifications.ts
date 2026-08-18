// ── Notification events & channels ──────────────────────────────────────────
// Single source of truth for which notifications exist, who they go to, and the
// per-channel (email / push) on-off settings. Superadmin/admin edit channels in
// the admin panel; every send site reads channelsFor() before sending.
//
// All notifications send immediately. Admin-alert email defaults are OFF (push
// on), so high-frequency events like signups don't flood inboxes — turn email on
// per event from the panel if wanted.

export interface NotifEvent {
  key: string
  label: string
  desc: string
  audience: 'admin' | 'player'
  emailKey: string
  pushKey: string
  emailDefault: boolean
  pushDefault: boolean
}

export const NOTIF_EVENTS: NotifEvent[] = [
  // ── Admin alerts (email OFF by default to avoid inbox floods) ──
  { key: 'signup',       label: 'Nuevo registro',          desc: 'Un jugador solicita acceso al club',          audience: 'admin',  emailKey: 'signup_email',       pushKey: 'signup_push',       emailDefault: false, pushDefault: true },
  { key: 'inscripcion',  label: 'Inscripción a partido',   desc: 'Un jugador se anota a un partido',             audience: 'admin',  emailKey: 'inscripcion_email',  pushKey: 'inscripcion_push',  emailDefault: false, pushDefault: true },
  { key: 'baja',         label: 'Baja de partido',         desc: 'Un jugador se retira de un partido',           audience: 'admin',  emailKey: 'baja_email',         pushKey: 'baja_push',         emailDefault: false, pushDefault: true },
  // ── Player events ──
  { key: 'apertura',     label: 'Inscripciones abiertas',  desc: 'Se abre la ventana de inscripción',           audience: 'player', emailKey: 'email_apertura',     pushKey: 'notif_apertura',     emailDefault: true,  pushDefault: true },
  { key: 'recordatorio', label: 'Recordatorio de partido', desc: 'A confirmados antes del partido',             audience: 'player', emailKey: 'email_recordatorio', pushKey: 'notif_recordatorio', emailDefault: true,  pushDefault: true },
  { key: 'cupos',        label: 'Cupos disponibles',       desc: 'A no-inscritos cuando quedan cupos',           audience: 'player', emailKey: 'cupos_email',        pushKey: 'notif_cupos',        emailDefault: false, pushDefault: true },
  { key: 'invitado',     label: 'Invitado confirmado',     desc: 'Al jugador cuando entra su invitado',          audience: 'player', emailKey: 'invitado_email',     pushKey: 'notif_invitados',    emailDefault: false, pushDefault: true },
  { key: 'promovido',    label: 'Promovido de espera',     desc: 'Al jugador que pasa de espera a confirmado',   audience: 'player', emailKey: 'promovido_email',    pushKey: 'promovido_push',     emailDefault: true,  pushDefault: true },
  { key: 'equipos',      label: 'Equipos confirmados',     desc: 'A los jugadores cuando se arman equipos',      audience: 'player', emailKey: 'equipos_email',      pushKey: 'equipos_push',       emailDefault: true,  pushDefault: true },
  { key: 'evaluaciones', label: 'Evaluaciones abiertas',   desc: 'A confirmados para votar tras el partido',     audience: 'player', emailKey: 'evaluaciones_email', pushKey: 'evaluaciones_push',  emailDefault: false, pushDefault: true },
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

// Per-club game configuration — how the club's teams are set up and play.
// Stored in app_settings (one row per key per club). Superadmin-only writes.
// Single source of truth for keys, defaults and labels (server + admin UI).

export const GAME_CONFIG = [
  { key: 'cupos_default',        label: 'Cupos partido normal',     desc: 'Jugadores por partido normal',           def: '14', min: 2,  max: 30 },
  { key: 'cupos_minitorneo',     label: 'Cupos minitorneo',         desc: 'Jugadores por minitorneo (3 equipos)',   def: '21', min: 6,  max: 30 },
  { key: 'max_invitados',        label: 'Invitados por jugador',    desc: 'Máximo de invitados por jugador/partido', def: '3',  min: 0,  max: 10 },
  { key: 'hora_partido_default', label: 'Hora de partido',          desc: 'Hora por defecto al crear partidos (HH:MM)',    def: '19:00' },
  { key: 'hora_apertura_default', label: 'Hora de apertura',        desc: 'Hora por defecto de apertura de inscripciones (HH:MM)', def: '10:00' },
  { key: 'dias_antes_default',   label: 'Días antes (apertura)',    desc: 'Días antes del partido en que abren inscripciones', def: '2', min: 0, max: 14 },
] as const

export const GAME_CONFIG_KEYS = GAME_CONFIG.map(c => c.key) as readonly string[]

export type GameConfigKey = typeof GAME_CONFIG[number]['key']

/** Read a numeric game setting with its default. */
export function gameNumber(settings: Record<string, unknown>, key: GameConfigKey): number {
  const def = GAME_CONFIG.find(c => c.key === key)!.def
  const raw = settings[key]
  const n = parseInt(String(raw ?? def), 10)
  return isNaN(n) ? parseInt(def, 10) : n
}

/** Read a string game setting with its default. */
export function gameString(settings: Record<string, unknown>, key: GameConfigKey): string {
  const def = GAME_CONFIG.find(c => c.key === key)!.def
  const raw = settings[key]
  return typeof raw === 'string' && raw.length > 0 ? raw : def
}

// Shared types for the admin panel

export interface Player {
  id: string
  username: string
  email: string
  role: string
  baneado: boolean
  aprobado: boolean
  uniform: boolean
  fecha_liberacion: string | null
  razon_ban: string | null
  ip_registro: string | null
  created_at: string
  avatar_url: string | null
}

export interface ActivityLog {
  id: string
  user_id: string | null
  username: string | null
  accion: string
  detalles: Record<string, unknown> | null
  ip: string | null
  created_at: string
}

export interface Invitado {
  id: string
  nombre: string
  estado: 'espera' | 'confirmado'
  posicion_espera: number | null
  player_id: string
  profiles: { username: string }
}

export interface Inscripcion {
  id: string
  estado: 'confirmado' | 'espera'
  posicion_espera: number | null
  partido_id: string
  created_at: string
  profiles: { username: string; id: string }
  partidos: { fecha: string; dia_semana: string }
  added_by_profile: { username: string } | null
}

export interface JugadorEquipo {
  id: string
  username: string
  avatar_url: string | null
  posicion: string
  habilidad: number
}

export interface Partido {
  id: string
  fecha: string
  dia_semana: string
  hora?: string
  cupos_total: number
  hora_apertura?: string
  dias_antes_apertura?: number
  inscripciones: { estado: string }[]
  invitados: { estado: string }[]
  evaluaciones_abiertas?: boolean
  equipos_confirmados?: boolean
  resultado?: string | null
  goles_a?: number | null
  goles_b?: number | null
  notif_apertura_sent?: boolean
  tipo?: 'normal' | 'minitorneo'
  puntos_blanco?: number | null
  puntos_negro?: number | null
  puntos_morado?: number | null
}

export interface HistorialPartido {
  id: string
  fecha: string
  dia_semana: string
  resultado: string | null
  goles_a: number | null
  goles_b: number | null
  equipos_confirmados: boolean
  cupos_total: number
  tipo?: 'normal' | 'minitorneo'
  inscripciones: { estado: string }[]
  player_badges: { badge_emoji: string; badge_nombre: string; profiles: { username: string } | null }[]
}

export interface RotacionEquipo {
  equipo_id: string
  color: 'blanco' | 'negro' | 'morado'
  porteroFijo: boolean
  porteroFijoId: string
  rotacionBanca: string[]
  rotacionPortero: string[]
}

/** Callback type used by tabs to run admin API actions */
export type AdminAction = (accion: string, extra: Record<string, string | boolean>) => Promise<boolean>

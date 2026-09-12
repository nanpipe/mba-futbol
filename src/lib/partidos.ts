import { fromZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TZ = 'America/Bogota'

/**
 * How long after kickoff the match stays on screen (list + lineups). At that
 * point the match is over: players stop seeing it and admins are asked whether
 * it was played.
 */
export const MATCH_VISIBLE_MS = 60 * 60 * 1000

/** More than this many confirmed players (guests included) → assume it was played. */
export const MIN_CONFIRMADOS_AUTO_JUGADO = 12

export interface VentanaPartido {
  abierta: boolean
  abreEn: Date   // UTC timestamp when window opens
  cierra: Date   // UTC timestamp when window closes (match time)
  termina: Date  // cierra + MATCH_VISIBLE_MS — match leaves the home screen
}

/**
 * Compute the inscription window for a specific partido.
 * Works on both client and server.
 */
export function calcularVentanaPartido(partido: {
  fecha: string             // 'YYYY-MM-DD' (Colombia date)
  hora?: string | null      // 'HH:MM:SS' or 'HH:MM' (Colombia time), default 19:00
  hora_apertura?: string | null    // Colombia time, default 10:00
  dias_antes_apertura?: number | null  // days before match to open, default 2
}, now: Date = new Date()): VentanaPartido {
  const hora = partido.hora ?? '19:00:00'
  const horaApertura = partido.hora_apertura ?? '10:00:00'
  const diasAntes = partido.dias_antes_apertura ?? 2

  // Compute apertura date: fecha - diasAntes days
  // Use T12:00:00 to safely subtract days without DST issues
  const fechaBase = new Date(partido.fecha + 'T12:00:00')
  const aperturaFecha = new Date(fechaBase)
  aperturaFecha.setDate(fechaBase.getDate() - diasAntes)
  const aperturaFechaStr = aperturaFecha.toISOString().split('T')[0]

  const abreEn = fromZonedTime(`${aperturaFechaStr}T${horaApertura}`, TZ)
  const cierra = fromZonedTime(`${partido.fecha}T${hora}`, TZ)
  const termina = new Date(cierra.getTime() + MATCH_VISIBLE_MS)

  return { abierta: now >= abreEn && now < cierra, abreEn, cierra, termina }
}

export function formatFechaPartido(fecha: Date | string): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha
  return format(toZonedTime(d, TZ), "EEEE d 'de' MMMM")
}

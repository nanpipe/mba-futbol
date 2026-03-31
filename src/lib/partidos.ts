import { fromZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TZ = 'America/Bogota'

export interface VentanaPartido {
  abierta: boolean
  abreEn: Date   // UTC timestamp when window opens
  cierra: Date   // UTC timestamp when window closes (match time)
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
}): VentanaPartido {
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

  const now = new Date()
  return { abierta: now >= abreEn && now < cierra, abreEn, cierra }
}

export interface VentanaInscripcion {
  abierta: boolean
  partidoFecha: Date | null
  partidoDia: string | null
  abreEn: Date | null
}

/** @deprecated Use calcularVentanaPartido with partido data from DB */
export function getVentanaActual(): VentanaInscripcion {
  const ahora = toZonedTime(new Date(), TZ)
  const diaSemana = ahora.getDay()
  const hora = ahora.getHours() + ahora.getMinutes() / 60

  // Sunday >= 10am, Monday, Tuesday before 7pm → Tuesday match
  if ((diaSemana === 0 && hora >= 10) || diaSemana === 1 || (diaSemana === 2 && hora < 19)) {
    const martes = new Date(ahora)
    const diasHasta = diaSemana === 0 ? 2 : diaSemana === 1 ? 1 : 0
    martes.setDate(ahora.getDate() + diasHasta)
    return { abierta: true, partidoFecha: martes, partidoDia: 'martes', abreEn: null }
  }

  // Thursday >= 10am, Friday before 7pm → Friday match
  if ((diaSemana === 4 && hora >= 10) || (diaSemana === 5 && hora < 19)) {
    const viernes = new Date(ahora)
    const diasHasta = diaSemana === 4 ? 1 : 0
    viernes.setDate(ahora.getDate() + diasHasta)
    return { abierta: true, partidoFecha: viernes, partidoDia: 'viernes', abreEn: null }
  }

  // Compute next opening
  let abreEn: Date
  if ((diaSemana === 0 || diaSemana === 4) && hora < 10) {
    abreEn = fromZonedTime(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 10, 0, 0), TZ)
  } else {
    const diasHastaDomingo = (7 - diaSemana) % 7 || 7
    const proximoDomingo = new Date(ahora)
    proximoDomingo.setDate(ahora.getDate() + diasHastaDomingo)
    proximoDomingo.setHours(10, 0, 0, 0)
    abreEn = fromZonedTime(proximoDomingo, TZ)
  }

  return { abierta: false, partidoFecha: null, partidoDia: null, abreEn }
}

export function formatFechaPartido(fecha: Date | string): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha
  return format(toZonedTime(d, TZ), "EEEE d 'de' MMMM")
}

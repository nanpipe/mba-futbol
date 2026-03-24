import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { addDays, nextDay, format } from 'date-fns'

const TZ = 'America/Bogota'

export interface VentanaInscripcion {
  abierta: boolean
  partidoFecha: Date | null
  partidoDia: 'martes' | 'viernes' | null
  abreEn: Date | null
}

export function getVentanaActual(): VentanaInscripcion {
  const ahora = toZonedTime(new Date(), TZ)
  const diaSemana = ahora.getDay()
  const hora = ahora.getHours() + ahora.getMinutes() / 60

  if ((diaSemana === 0 && hora >= 10) || diaSemana === 1) {
    // Domingo >= 10am o lunes → partido del martes ESTA semana
    const martes = new Date(ahora)
    const diasHasta = diaSemana === 0 ? 2 : 1
    martes.setDate(ahora.getDate() + diasHasta)
    return { abierta: true, partidoFecha: martes, partidoDia: 'martes', abreEn: null }
  }

  if (diaSemana === 4 && hora >= 10) {
    // Jueves >= 10am → partido del viernes ESTA semana
    const viernes = new Date(ahora)
    viernes.setDate(ahora.getDate() + 1)
    return { abierta: true, partidoFecha: viernes, partidoDia: 'viernes', abreEn: null }
  }

  // Calcular cuándo abre la próxima ventana
  let abreEn: Date
  if ((diaSemana === 0 || diaSemana === 4) && hora < 10) {
    abreEn = new Date(ahora)
    abreEn.setHours(10, 0, 0, 0)
    abreEn = fromZonedTime(abreEn, TZ)
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

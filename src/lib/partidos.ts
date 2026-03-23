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

  if (diaSemana === 0 && hora >= 10) {
    return { abierta: true, partidoFecha: nextDay(ahora, 2), partidoDia: 'martes', abreEn: null }
  }
  if (diaSemana === 1) {
    return { abierta: true, partidoFecha: nextDay(ahora, 2), partidoDia: 'martes', abreEn: null }
  }
  if (diaSemana === 4 && hora >= 10) {
    return { abierta: true, partidoFecha: addDays(ahora, 1), partidoDia: 'viernes', abreEn: null }
  }

  let abreEn: Date
  if ((diaSemana === 0 || diaSemana === 4) && hora < 10) {
    const hoy = new Date(ahora)
    hoy.setHours(10, 0, 0, 0)
    abreEn = fromZonedTime(hoy, TZ)
  } else {
    const diasHastaDomingo = (7 - diaSemana) % 7 || 7
    const proximoDomingo = addDays(ahora, diasHastaDomingo)
    proximoDomingo.setHours(10, 0, 0, 0)
    abreEn = fromZonedTime(proximoDomingo, TZ)
  }

  return { abierta: false, partidoFecha: null, partidoDia: null, abreEn }
}

export function formatFechaPartido(fecha: Date | string): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha
  return format(toZonedTime(d, TZ), "EEEE d 'de' MMMM")
}

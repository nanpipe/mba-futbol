import { calcularVentanaPartido } from '@/lib/partidos'

// ── Cuándo salen las notificaciones de un partido ────────────────────────────
//
// Las dos notificaciones del calendario tienen una hora AUTOMÁTICA, derivada del
// partido, y `notif_apertura_at` / `notif_recordatorio_at` son un OVERRIDE que
// el admin pone cuando quiere otra hora. Sin override no es que no haya
// notificación: es que sale a la hora calculada.
//
// El panel decía "📣 Sin notif. apertura" en todos los partidos que no tenían
// override, o sea en casi todos, y eso es falso: la notificación iba a salir
// igual. Un admin que lea eso o fuerza una notificación que ya iba a salir, o
// cree que el club se va a quedar sin aviso y no hace nada.
//
// El cálculo vive acá y no en el cron para que la pantalla y el cron no puedan
// decir cosas distintas — mismo motivo que `lib/puntaje.ts`.

/** La notificación de apertura sale 5 minutos ANTES de que abran inscripciones. */
export const APERTURA_OFFSET_MS = 5 * 60 * 1000

/** El recordatorio sale 9 horas antes de la hora del partido. */
export const RECORDATORIO_OFFSET_MS = 9 * 60 * 60 * 1000

export interface PartidoHorario {
  fecha: string
  hora?: string | null
  hora_apertura?: string | null
  dias_antes_apertura?: number | null
}

export interface ProgramaNotif {
  cuando: Date
  /** false = el admin le puso una hora a mano. */
  automatica: boolean
}

const conOverride = (override: string | null | undefined, automatica: Date): ProgramaNotif => {
  if (override) {
    const d = new Date(override)
    if (!Number.isNaN(d.getTime())) return { cuando: d, automatica: false }
  }
  return { cuando: automatica, automatica: true }
}

export function programaApertura(p: PartidoHorario, override?: string | null): ProgramaNotif {
  const abre = calcularVentanaPartido(p).abreEn
  return conOverride(override, new Date(abre.getTime() - APERTURA_OFFSET_MS))
}

export function programaRecordatorio(p: PartidoHorario, override?: string | null): ProgramaNotif {
  // `cierra` es la hora del partido: las inscripciones cierran al arrancar.
  const arranca = calcularVentanaPartido(p).cierra
  return conOverride(override, new Date(arranca.getTime() - RECORDATORIO_OFFSET_MS))
}

// ── Formato de la fecha, armado a mano ───────────────────────────────────────
// `toLocaleString('es-CO', …)` NO sirve acá: Node y Chrome escriben el "a. m."
// con espacios distintos (uno usa espacio normal y el otro un espacio angosto
// que no se ve), y como esto se pinta en el servidor y otra vez en el
// navegador, React lo cuenta como hydration mismatch y bota el árbol entero.
// Se ve como un error rojo en el overlay de desarrollo y como un parpadeo en
// producción. Armar la cadena a mano la vuelve idéntica en los dos lados.
//
// Los números sí salen de Intl, porque es lo que sabe pasar un instante UTC a
// la hora de Colombia sin que tengamos que hacer aritmética de zonas.

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const partesCO = (d: Date) => {
  // 'en-CA' + hour12:false da siempre "YYYY-MM-DD, HH:MM", en todas partes.
  const txt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  const m = /(\d{4})-(\d{2})-(\d{2}),?\s+(\d{2}):(\d{2})/.exec(txt)
  if (!m) return null
  return { mes: Number(m[2]), dia: Number(m[3]), hora: Number(m[4]) % 24, min: Number(m[5]) }
}

/** "30 sep · 9:55 a.m." — igual en el servidor y en el navegador. */
export function fechaHoraCO(d: Date): string {
  const p = partesCO(d)
  if (!p) return ''
  const ampm = p.hora >= 12 ? 'p.m.' : 'a.m.'
  const h12 = p.hora % 12 === 0 ? 12 : p.hora % 12
  return `${p.dia} ${MESES_CORTOS[p.mes - 1]} · ${h12}:${String(p.min).padStart(2, '0')} ${ampm}`
}

/** "30/9 9:55" — para la tarjeta cerrada, donde no sobra ancho. */
export function fechaHoraCortaCO(d: Date): string {
  const p = partesCO(d)
  if (!p) return ''
  const h12 = p.hora % 12 === 0 ? 12 : p.hora % 12
  return `${p.dia}/${p.mes} ${h12}:${String(p.min).padStart(2, '0')}`
}

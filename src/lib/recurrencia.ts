// ── Partidos que se repiten cada semana ──────────────────────────────────────
//
// El club juega los mismos días todas las semanas, así que crear cada partido a
// mano era la tarea que más se repetía. El primer intento fue "crear 8 de una":
// funcionaba, pero dejaba el calendario con ocho tarjetas de partidos a los que
// falta mes y medio, y eso no se puede mirar.
//
// Ahora se guarda una PLANTILLA y el cron va creando de a uno, manteniendo unos
// pocos por delante. El calendario queda como estaba — dos o tres partidos — y
// nadie tiene que acordarse de crear el siguiente.
//
// Se guarda en `app_settings` (clave `partidos_recurrentes`) y NO en una tabla
// nueva a propósito: una tabla necesita migración, las migraciones las corre el
// usuario a mano en Supabase, y hasta que no la corra el código no puede salir
// a producción. `app_settings` ya existe y ya se escribe desde el panel.
//
// `creado_hasta` es lo que hace que esto sea seguro de repetir: la plantilla
// solo genera fechas POSTERIORES a la última que generó. Así el cron puede
// correr cada minuto sin duplicar nada, y un partido que el admin borre no
// vuelve a aparecer solo — que es justo lo que uno espera al borrarlo.

export const RECURRENCIA_KEY = 'partidos_recurrentes'

/** Cuántos partidos de cada serie se mantienen creados por delante. */
export const SEMANAS_ADELANTE = 2

/** Tope de series activas. Más que esto es un calendario, no una repetición. */
export const MAX_PLANTILLAS = 8

export interface PlantillaRecurrente {
  id: string
  /** 0 = domingo … 6 = sábado. Sale de la fecha del primer partido. */
  dia: number
  /** 'HH:MM:SS' */
  hora: string
  hora_apertura: string
  dias_antes: number
  cupos: number
  tipo: 'normal' | 'minitorneo'
  lugar: string
  /** YYYY-MM-DD del primer partido de la serie. */
  desde: string
  /** YYYY-MM-DD del último partido que ya generó. */
  creado_hasta: string
}

export const DIAS_SEMANA = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
] as const

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const HORA_RE = /^\d{2}:\d{2}(:\d{2})?$/

/**
 * Suma días a una fecha 'YYYY-MM-DD'.
 *
 * En UTC sobre la fecha pelada: `partidos.fecha` es un DATE sin zona y Colombia
 * no tiene horario de verano, así que sumar 7×86.400.000 ms cae siempre en el
 * mismo día de la semana. Hacerlo con `setDate` sobre una fecha local se corre
 * según dónde corra el servidor.
 */
export function sumarDias(fecha: string, dias: number): string {
  const t = new Date(`${fecha}T00:00:00Z`).getTime()
  if (Number.isNaN(t)) return fecha
  return new Date(t + dias * 86400000).toISOString().slice(0, 10)
}

/** Día de la semana (0–6) de una fecha 'YYYY-MM-DD', leída como UTC. */
export function diaDeFecha(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay()
}

/** Lee la lista de plantillas guardada, descartando lo que no cuadre. */
export function parsePlantillas(value: unknown): PlantillaRecurrente[] {
  if (!Array.isArray(value)) return []
  const out: PlantillaRecurrente[] = []
  const vistos = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim().slice(0, 64) : ''
    const desde = typeof r.desde === 'string' && FECHA_RE.test(r.desde) ? r.desde : ''
    const creado_hasta = typeof r.creado_hasta === 'string' && FECHA_RE.test(r.creado_hasta) ? r.creado_hasta : desde
    const dia = Number(r.dia)
    const cupos = Number(r.cupos)
    const dias_antes = Number(r.dias_antes)
    if (!id || vistos.has(id) || !desde) continue
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue
    if (!Number.isInteger(cupos) || cupos < 2 || cupos > 30) continue
    if (!Number.isInteger(dias_antes) || dias_antes < 0 || dias_antes > 14) continue
    const hora = typeof r.hora === 'string' && HORA_RE.test(r.hora) ? r.hora : '19:00:00'
    const hora_apertura = typeof r.hora_apertura === 'string' && HORA_RE.test(r.hora_apertura) ? r.hora_apertura : '10:00:00'
    vistos.add(id)
    out.push({
      id, dia, hora, hora_apertura, dias_antes, cupos,
      tipo: r.tipo === 'minitorneo' ? 'minitorneo' : 'normal',
      lugar: typeof r.lugar === 'string' ? r.lugar.trim().slice(0, 120) : '',
      desde, creado_hasta,
    })
  }
  return out.slice(0, MAX_PLANTILLAS)
}

/**
 * Qué fechas le toca crear a una plantilla.
 *
 * Solo mira hacia adelante desde `creado_hasta`, así que llamarla dos veces
 * seguidas sin guardar da lo mismo, y una fecha que ya pasó no revive.
 * `ocupadas` son las fechas que ya tienen partido: se saltan sin consumir cupo
 * de la ventana, porque el partido de ese día ya existe.
 */
export function fechasPorCrear(
  p: PlantillaRecurrente,
  hoy: string,
  ocupadas: Set<string>,
  adelante: number = SEMANAS_ADELANTE
): string[] {
  const out: string[] = []
  // Cuántos de la serie ya hay de hoy en adelante: eso es lo que decide si
  // falta crear o no. Contar los que pasaron haría que la serie se frenara.
  let vigentes = 0
  for (const f of ocupadas) if (f >= hoy && diaDeFecha(f) === p.dia) vigentes++

  let cursor = p.creado_hasta
  // Cinturón: la ventana es de unas pocas semanas, así que 60 vueltas sobran
  // para cualquier caso real y evitan un ciclo infinito si algo viene raro.
  for (let i = 0; i < 60 && vigentes + out.length < adelante; i++) {
    cursor = sumarDias(cursor, 7)
    if (cursor < hoy) continue          // la serie estuvo quieta: alcanzar el presente
    if (ocupadas.has(cursor)) { vigentes++; continue }
    out.push(cursor)
  }
  return out
}

/**
 * ¿Los partidos de este día se repiten solos?
 *
 * Se decide por el día de la semana y no por qué fila creó cuál: guardar el
 * vínculo partido→plantilla necesitaría una columna nueva (migración), y lo que
 * la tarjeta tiene que decir es "los martes se repiten solos", que es un hecho
 * del calendario y no de esa fila en particular.
 */
export function plantillaDe(
  partido: { fecha: string },
  plantillas: PlantillaRecurrente[]
): PlantillaRecurrente | null {
  if (!FECHA_RE.test(partido.fecha)) return null
  const dia = diaDeFecha(partido.fecha)
  return plantillas.find(p => p.dia === dia && partido.fecha >= p.desde) ?? null
}

/**
 * "los martes", "los sábados".
 *
 * De lunes a viernes el nombre no cambia en plural; domingo y sábado sí. Poner
 * la "s" a todos daba "los martess".
 */
export const nombreDia = (dia: number) => {
  const d = DIAS_SEMANA[dia]
  if (!d) return ''
  return `los ${d}${dia === 0 || dia === 6 ? 's' : ''}`
}

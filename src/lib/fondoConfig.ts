// ── Ajustes del fondo ────────────────────────────────────────────────────────
//
// Antes esto era una constante en `lib/fondo.ts` (`APORTE_POR_PERSONA = 1000`).
// Ser constante era el problema: 14.000 es un PRECIO, y los precios cambian.
// Cambiarla recalculaba toda la historia con el valor nuevo, así que el fondo de
// mayo se reescribía solo cuando subiera la cancha.
//
// Ahora el monto real de cada partido se guarda en `fondo_movimientos`, y esto
// es nada más el valor que viene prellenado al registrarlo. Cambiarlo no toca un
// solo partido ya registrado.

export const FONDO_CONFIG = [
  {
    key: 'fondo_aporte_partido',
    label: 'Aporte por partido',
    desc: 'Lo que suele sobrar para el fondo después de pagar la cancha. Es solo el valor que viene prellenado al registrar un partido; en cada uno se puede cambiar',
    def: '14000', min: 0, max: 1000000,
  },
] as const

export const FONDO_CONFIG_KEYS = FONDO_CONFIG.map(c => c.key) as readonly string[]

const APORTE = FONDO_CONFIG[0]

/** Lee el aporte por partido de un mapa de settings ya leído. */
export function aporteDeSettings(settings: Record<string, unknown>): number {
  const n = parseInt(String(settings[APORTE.key] ?? APORTE.def), 10)
  if (isNaN(n)) return parseInt(APORTE.def, 10)
  return Math.max(APORTE.min, Math.min(APORTE.max, n))
}

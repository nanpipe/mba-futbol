// Team positions a player can pick (profile + balancer). Single source of truth.
// Note: the FIFA card (mi-carta) uses a different, card-specific position list.
export const POSICIONES = ['portero', 'defensa', 'medio', 'delantero', 'cualquiera'] as const
export type Posicion = typeof POSICIONES[number]

export function isPosicion(v: unknown): v is Posicion {
  return typeof v === 'string' && (POSICIONES as readonly string[]).includes(v)
}

// Ausencia — an admin marks a player away (trip, injury) for a date range.
//
// What it does, and deliberately nothing more:
//   · waives the "no se inscribió" rating penalty for matches in the range
//   · skips sign-up nudges (apertura, cupos) for those matches
//   · blocks self sign-up while active
//
// Only admins can set it: if players could, anyone would shield their rating.
// And it never softens a match the player actually plays — confirmed players
// are rated in full — so it can't be used as cover to play without risk.

export const AUSENCIA_MAX_DIAS = 90

export interface Ausencia {
  ausente_desde?: string | null
  ausente_hasta?: string | null
}

/** Is the player marked absent on `fecha` (YYYY-MM-DD, Colombia)? */
export function ausenteEn(p: Ausencia | null | undefined, fecha: string): boolean {
  if (!p?.ausente_hasta || !p.ausente_desde) return false
  return p.ausente_desde <= fecha && fecha <= p.ausente_hasta
}

// Post-match peer recognitions. `peso` feeds the player rating (Phase 2):
//   positive performance → raises rating, negative → lowers it.
//   Behavioral/fun badges use peso 0 (no skill impact).
export const CATEGORIAS = [
  { id: 'mvp',          emoji: '🏆',  nombre: 'MVP del Partido',  peso:  2 },
  { id: 'goleador',     emoji: '⚽',  nombre: 'Goleador',          peso:  1 },
  { id: 'defensa',      emoji: '🛡️',  nombre: 'Mejor Defensa',     peso:  1 },
  { id: 'portero',      emoji: '🧤',  nombre: 'Mejor Portero',     peso:  1 },
  { id: 'tecnico',      emoji: '🎯',  nombre: 'El Técnico',        peso:  1 },
  { id: 'desaparecido', emoji: '💤',  nombre: 'Desaparecido',      peso: -1 },
  { id: 'aizaga',       emoji: '🥅',  nombre: 'Aizaga del Partido', peso: -1 }, // regaló los goles
  { id: 'discutidor',   emoji: '🗣️',  nombre: 'Más Discutidor',    peso:  0 }, // behavioral, no skill impact
] as const

export type CategoriaId = typeof CATEGORIAS[number]['id']

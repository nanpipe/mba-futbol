export const CATEGORIAS = [
  { id: 'mvp',          emoji: '🏆', nombre: 'MVP del Partido'      },
  { id: 'defensa',      emoji: '🛡️', nombre: 'Mejor Defensa'        },
  { id: 'goleador',     emoji: '⚽', nombre: 'Goleador'             },
  { id: 'kilometros',   emoji: '🏃', nombre: 'Más Kilómetros'       },
  { id: 'tecnico',      emoji: '🎯', nombre: 'El Técnico'           },
  { id: 'desaparecido', emoji: '💤', nombre: 'Desaparecido'         },
  { id: 'discutidor',   emoji: '🗣️', nombre: 'Más Discutidor'       },
  { id: 'jugada',       emoji: '😂', nombre: 'Jugada del Partido'   },
] as const

export type CategoriaId = typeof CATEGORIAS[number]['id']

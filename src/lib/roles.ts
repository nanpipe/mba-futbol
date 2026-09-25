// ── El color de cada rol ─────────────────────────────────────────────────────
// En la lista del panel el rol NO se escribe: se pinta. La tarjeta entera lleva
// el color (barra lateral + fondo), y eso alcanza para ver de un vistazo quién
// manda. Las etiquetas "SUPERADMIN" / "ADMIN" de 9 px que había antes decían lo
// mismo dos veces y le robaban la línea al nombre.
//
// El nombre del rol sí aparece, escrito, dentro de la ficha (Ver): ahí hay
// espacio y ahí es donde se va a mirar el detalle.
//
// Vive en un módulo aparte para que la lista y la ficha no se separen de color:
// una tarjeta naranja que abre una ficha morada es peor que no tener color.

export interface ColorRol {
  acento: string
  fondo: string
  borde: string
  /** Cómo se escribe el rol donde sí se escribe. null = no se muestra. */
  etiqueta: string | null
}

export const COLOR_ROL: Record<string, ColorRol> = {
  superadmin: { acento: '#a78bfa', fondo: '#150b26', borde: '#3f2370', etiqueta: 'SUPERADMIN' },
  admin:      { acento: '#fbbf24', fondo: '#1c1503', borde: '#4d3a10', etiqueta: 'ADMIN' },
  player:     { acento: '#4ade80', fondo: 'var(--bg-card)', borde: 'var(--border)', etiqueta: null },
}

export const colorDeRol = (role: string): ColorRol => COLOR_ROL[role] ?? COLOR_ROL.player

// ── Colores del club ─────────────────────────────────────────────────────────
//
// El club elige TRES cosas: color principal, acento y uno de tres fondos
// oscuros. Todo lo demás se deriva acá, con contraste garantizado: elija lo que
// elija el superadmin, un botón no puede quedar ilegible.
//
// Es una función pura por la misma razón que calcularPuntaje(): la usan el
// servidor (el <style> que pinta layout.tsx), el manifest y la vista previa del
// editor, y las tres tienen que dar exactamente lo mismo.
//
// Lo que NO es configurable (y no sale de acá): los semánticos —verde "subió",
// rojo "bajó/cancelar", ámbar "aviso"—, los colores de equipo y los de rol.
// Son el idioma de la app; ver docs/diseno/INFORME.md §5.7.
//
// SEGURIDAD: el resultado termina dentro de un <style> en el HTML de todo el
// club. parseTema() solo deja pasar `#rrggbb` y un fondo de la lista, y
// derivarTokens() solo produce hex. Si se afloja la validación, un valor como
// `red}</style><script>…` es un XSS persistente.

export const TEMA_KEY = 'tema'

export type FondoTema = 'carbon' | 'noche' | 'cancha'

export interface Tema {
  primario: string
  acento: string
  fondo: FondoTema
}

/** El de MBA hoy. Con este tema no se inyecta nada: manda globals.css. */
export const TEMA_DEFAULT: Tema = { primario: '#4ade80', acento: '#fbbf24', fondo: 'carbon' }

export const esTemaDefault = (t: Tema) =>
  t.primario === TEMA_DEFAULT.primario && t.acento === TEMA_DEFAULT.acento && t.fondo === TEMA_DEFAULT.fondo

export const FONDOS: Record<FondoTema, { nombre: string; bg: string; card: string; elevated: string }> = {
  carbon: { nombre: 'Carbón',       bg: '#080808', card: '#111111', elevated: '#1a1a1a' },
  noche:  { nombre: 'Azul noche',   bg: '#070b14', card: '#0f1522', elevated: '#172033' },
  cancha: { nombre: 'Verde cancha', bg: '#06100a', card: '#0d1a12', elevated: '#14251a' },
}

/** Muestras que ofrece el editor (además de "otro color"). */
export const MUESTRAS_PRIMARIO = ['#4ade80', '#22d3ee', '#60a5fa', '#f43f5e', '#f97316', '#facc15', '#a78bfa', '#ffffff']
export const MUESTRAS_ACENTO = ['#fbbf24', '#f97316', '#f472b6', '#38bdf8', '#a3e635', '#e5e5e5']

const HEX = /^#[0-9a-f]{6}$/

/** Lee lo guardado. Cualquier cosa que no sea exactamente válida → null. */
export function parseTema(value: unknown): Tema | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const primario = typeof v.primario === 'string' ? v.primario.trim().toLowerCase() : ''
  const acento = typeof v.acento === 'string' ? v.acento.trim().toLowerCase() : ''
  const fondo = v.fondo
  if (!HEX.test(primario) || !HEX.test(acento)) return null
  if (fondo !== 'carbon' && fondo !== 'noche' && fondo !== 'cancha') return null
  return { primario, acento, fondo }
}

// ── Color ───────────────────────────────────────────────────────────────────

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const hex = (a: number[]) =>
  '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

function luminancia(h: string): number {
  const [r, g, b] = rgb(h).map(v => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contraste WCAG entre dos hex (1 a 21). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Mezcla a→b en proporción t (0 = a, 1 = b). */
export function mezclar(a: string, b: string, t: number): string {
  const A = rgb(a), B = rgb(b)
  return hex(A.map((v, i) => v + (B[i] - v) * t))
}

/** Aclara `c` hacia blanco hasta llegar a `min` de contraste contra `fondo`. */
export function legible(c: string, fondo: string, min: number): string {
  if (contraste(c, fondo) >= min) return c
  for (let t = 0.04; t <= 1.0001; t += 0.04) {
    const x = mezclar(c, '#ffffff', t)
    if (contraste(x, fondo) >= min) return x
  }
  return '#ffffff'
}

/** Tono (0–360) y saturación (0–1) de un hex. */
function tono(h: string): { h: number; s: number } {
  const [r, g, b] = rgb(h).map(v => v / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (!d) return { h: 0, s: 0 }
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (x * 60 + 360) % 360, s: d / (1 - Math.abs(mx + mn - 1)) }
}

/**
 * Distancia de tono en grados. Dos colores saturados a menos de ~30° se leen
 * como "el mismo color" en una pantalla chica aunque difieran en brillo. Si
 * alguno es casi gris, no compiten: 999.
 */
export function distanciaTono(a: string, b: string): number {
  const A = tono(a), B = tono(b)
  if (A.s < 0.25 || B.s < 0.25) return 999
  const d = Math.abs(A.h - B.h)
  return Math.min(d, 360 - d)
}

// ── Tokens ──────────────────────────────────────────────────────────────────

/**
 * Las variables CSS que pisa el tema. Solo marca y superficies: los
 * semánticos (--pos, --red, --amber, …) no aparecen a propósito.
 */
export function derivarTokens(tema: Tema): Record<string, string> {
  const F = FONDOS[tema.fondo]
  // El principal se usa como fondo de botón Y como texto (nombre del club,
  // enlaces, "TÚ"). Un solo valor para los dos: se aclara lo justo para leerse
  // como texto sobre la superficie más clara. Un azul marino sube a un azul
  // que se lee; un verde claro no se toca.
  const primary = legible(tema.primario, F.elevated, 4.5)
  const accent = legible(tema.acento, F.elevated, 4.5)
  // Texto sobre el botón: el negro del fondo si alcanza (siempre alcanza con
  // un principal ya aclarado), si no blanco.
  const onPrimary = contraste(F.bg, primary) >= 4.5 ? F.bg : '#ffffff'

  const carbon = tema.fondo === 'carbon'
  return {
    '--bg': F.bg,
    '--bg-card': F.card,
    '--bg-elevated': F.elevated,
    // En carbón, los valores de globals.css tal cual: el fondo por defecto no
    // debe mover un píxel. En los otros, derivados del tinte del fondo.
    '--border': carbon ? '#2e2e2e' : mezclar(F.card, '#ffffff', 0.14),
    '--border-light': carbon ? '#6b6b6b' : legible(mezclar(F.card, '#ffffff', 0.32), F.elevated, 3),
    '--text-muted': carbon ? '#a0a0a0' : legible('#a0a0a0', F.elevated, 6),
    '--text-dim': carbon ? '#8a8a8a' : legible('#8a8a8a', F.elevated, 4.5),

    '--primary': primary,
    '--primary-hover': mezclar(primary, '#000000', 0.15),
    '--on-primary': onPrimary,
    '--primary-line': legible(mezclar(primary, '#000000', 0.35), F.card, 3),
    '--primary-deep': mezclar(primary, '#000000', 0.6),
    '--primary-soft': mezclar(F.card, primary, 0.14),
    '--accent': accent,
  }
}

/** CSS listo para el <style> del <head>. Solo hex y nombres fijos: seguro. */
export function cssDelTema(tema: Tema): string {
  const decl = Object.entries(derivarTokens(tema)).map(([k, v]) => `${k}:${v}`).join(';')
  // `html:root` le gana en especificidad al `:root` de globals.css sin
  // depender del orden en que se cargan las hojas.
  return `html:root{${decl}}`
}

export interface ChequeoTema {
  texto: string
  ok: boolean
  detalle: string
}

/** Lo que el editor le muestra al superadmin. Avisan, no bloquean. */
export function chequeosTema(tema: Tema): ChequeoTema[] {
  const F = FONDOS[tema.fondo]
  const t = derivarTokens(tema)
  const out: ChequeoTema[] = []
  const r = contraste(t['--on-primary'], t['--primary'])
  out.push({ texto: 'Texto sobre el botón principal', ok: r >= 4.5, detalle: `${r.toFixed(1)}:1` })
  const aclaradoP = t['--primary'] !== tema.primario
  out.push({
    texto: 'Principal como texto',
    ok: !aclaradoP,
    detalle: aclaradoP ? 'se aclara un poco para que se lea sobre el fondo' : `${contraste(tema.primario, F.elevated).toFixed(1)}:1`,
  })
  const aclaradoA = t['--accent'] !== tema.acento
  out.push({
    texto: 'Acento como texto',
    ok: !aclaradoA,
    detalle: aclaradoA ? 'se aclara un poco para que se lea sobre el fondo' : `${contraste(tema.acento, F.elevated).toFixed(1)}:1`,
  })
  const SEMANTICOS: [string, string][] = [
    ['#4ade80', 'al verde de "subió" y "confirmado"'],
    ['#f87171', 'al rojo de "bajó" y "cancelar"'],
    ['#fbbf24', 'al ámbar de "espera" y avisos'],
  ]
  // Con los colores de siempre no se avisa: el verde de MBA ES el de "subió"
  // desde el principio, y avisarlo en cada visita solo ensucia.
  if (esTemaDefault(tema)) return out
  for (const [c, nombre] of SEMANTICOS) {
    const d = distanciaTono(tema.primario, c)
    if (d < 30) out.push({ texto: `Se parece ${nombre}`, ok: false, detalle: 'se puede usar, pero se van a confundir' })
  }
  return out
}

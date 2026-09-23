// ── El número de camiseta sale del username ─────────────────────────────────
//
// En este club la convención es que el username termina en el dorsal:
// `alexis16` → 16, `guerrero44` → 44, `ortiz97` → 97. No hay columna en la
// base y no hace falta: el dato ya está escrito, solo había que leerlo.
//
// Para qué sirve: cuando alguien no tiene foto, el avatar mostraba la inicial
// del username. Eso no distingue a nadie — en el club hay CINCO usernames que
// empiezan por "j" (jbravo30, juli9, jj21, jhonsito23, jsanchez17). El dorsal
// sí los distingue, y además es como se reconocen en la cancha.
//
// No todos lo tienen (`pipesolarte` no lleva número), así que esto devuelve
// null y quien llama cae a la inicial.

/**
 * Dorsal al final del username, o null.
 *
 * Solo acepta UNA o DOS cifras finales, y la comprobación es sobre la racha
 * completa de dígitos del final: si son tres o más no es un dorsal, es otra
 * cosa. Así `user2024` no se convierte en el "24" — el corte por longitud
 * fija se lo habría llevado. Se hace contando dígitos y no con un lookbehind
 * en la expresión regular porque esos no existen en Safari anterior a 16.4, y
 * aquí la mitad de los celulares son iPhone.
 */
export function numeroDeUsername(username: string | null | undefined): string | null {
  if (typeof username !== 'string') return null
  let i = username.length
  while (i > 0 && username[i - 1] >= '0' && username[i - 1] <= '9') i--
  const digitos = username.slice(i)
  if (digitos.length < 1 || digitos.length > 2) return null
  // Todo dígitos y nada más no es un username con dorsal, es un número suelto.
  if (i === 0) return null
  const n = Number(digitos)
  if (!Number.isInteger(n) || n < 1 || n > 99) return null
  return String(n)
}

/** Lo que va dentro del círculo cuando no hay foto: el dorsal, o la inicial. */
export function inicialONumero(username: string | null | undefined): string {
  const n = numeroDeUsername(username)
  if (n) return n
  const u = typeof username === 'string' ? username.trim() : ''
  return u ? u[0].toUpperCase() : '?'
}

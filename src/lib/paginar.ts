/**
 * Lee una tabla entera por páginas.
 *
 * PostgREST devuelve como máximo ~1000 filas por petición y lo hace en silencio:
 * no hay error, simplemente faltan datos. Cualquier conteo hecho sobre el
 * resultado de un `.select()` sin paginar es correcto solo mientras la tabla sea
 * chica, y deja de serlo sin avisar. Usar esto siempre que se lean votos,
 * pulgares, inscripciones o eventos de varios partidos a la vez.
 *
 * Cada página debe ordenarse por una columna única (`id`): sin ORDER BY, dos
 * consultas seguidas no tienen por qué devolver las filas en el mismo orden y
 * la paginación se saltaría unas y repetiría otras.
 *
 * Vivía dentro de api/admin. Se sacó acá cuando el historial necesitó lo mismo:
 * dos copias de esta función es cuestión de tiempo para que una se arregle y la
 * otra no.
 */
export async function leerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>,
  tam = 1000
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += tam) {
    const { data, error } = await pagina(i, i + tam - 1)
    if (error) { console.error('[leerTodo] página', i, error); break }
    const filas = (data ?? []) as T[]
    out.push(...filas)
    if (filas.length < tam) break
    if (out.length > 200000) break  // cinturón: nunca dar vueltas sin fin
  }
  return out
}

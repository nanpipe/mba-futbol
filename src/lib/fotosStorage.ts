// ── Limpieza del bucket de fotos de partido ─────────────────────────────────
//
// Vive aparte de `api/admin/foto/route.ts` porque un archivo de ruta de Next
// solo puede exportar handlers y config: cualquier otro export rompe el build,
// y sin poder exportarlo esto no se podría probar.

/** Lo mínimo que se necesita del cliente de storage, para poder simularlo. */
export interface CarpetaStorage {
  list(
    carpeta: string,
    opts: { limit: number; offset: number; sortBy: { column: string; order: string } }
  ): PromiseLike<{ data: { name: string }[] | null; error: unknown }>
}

/** Tope por página de `storage.list()`, que es además su valor por defecto. */
export const PAGINA_STORAGE = 100

/**
 * Nombres de TODOS los archivos de una carpeta del bucket.
 *
 * `storage.list()` devuelve como máximo 100 entradas y ese es también su valor
 * por defecto: pedirlo sin paginar da una lista corta sin ningún error, igual
 * que PostgREST con su tope de 1000 filas (ver la trampa en HANDOFF). Subir el
 * límite a un número grande sería el mismo error con otro número, así que se
 * recorre de verdad. Se ordena por nombre para que las páginas no repitan ni
 * se salten entradas.
 */
export async function listarCarpeta(
  storage: CarpetaStorage,
  carpeta: string,
  tam = PAGINA_STORAGE
): Promise<string[]> {
  const nombres: string[] = []
  for (let offset = 0; ; offset += tam) {
    const { data, error } = await storage.list(carpeta, {
      limit: tam, offset, sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw error
    const pagina = data ?? []
    nombres.push(...pagina.map(o => o.name))
    if (pagina.length < tam) break
    if (nombres.length > 5000) break   // cinturón: nunca dar vueltas sin fin
  }
  return nombres
}

/**
 * Qué archivos de la carpeta hay que borrar: todos menos el que la base apunta.
 *
 * Se decide contra `vigenteUrl` —lo que `partidos.foto_url` dice AHORA— y no
 * contra la ruta que acaba de subir esta petición. Esa diferencia es la que
 * arregla la carrera: si dos admins suben foto al mismo partido a la vez, la
 * base termina apuntando a una sola, y si cada petición conservara "la suya",
 * la que perdiera la carrera borraría la foto ganadora y dejaría la tarjeta
 * rota. Mirando la vigente, las dos limpiezas conservan la misma y el
 * resultado es correcto sin importar en qué orden terminen.
 *
 * Si no hay URL vigente no se borra nada: sin saber cuál se queda, borrar es
 * peor que dejar basura.
 */
export function sobrantes(nombres: string[], carpeta: string, vigenteUrl: string | null | undefined): string[] {
  if (!vigenteUrl) return []
  return nombres
    .map(n => `${carpeta}/${n}`)
    // `endsWith` y no comparar la URL entera porque foto_url es la URL pública
    // completa del bucket y aquí solo se manejan rutas relativas.
    .filter(p => !vigenteUrl.endsWith(`/${p}`))
}

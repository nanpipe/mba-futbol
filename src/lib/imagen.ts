// ── Recorte y compresión de la foto del partido ─────────────────────────────
//
// La app se usa en celular y las fotos salen de la cámara: 4000×3000 px y
// varios MB. Subirlas crudas costaba dos cosas — el giga de storage del plan
// gratis, y sobre todo los 5 GB/mes de descarga, porque la foto del último
// partido la baja cada jugador cada vez que abre el home.
//
// Aquí se recorta a 16:9, se reduce a 1280 px de ancho y se pasa a WebP. Una
// foto de ~4 MB queda en ~150 KB: unas 25 veces menos, y de paso todas las
// tarjetas del historial quedan con la misma forma.
//
// Por qué 1280 y no 1024: un celular moderno tiene ~390 px CSS de ancho pero
// DPR 3, o sea ~1170 píxeles físicos. A 1024 la foto se vería escalada hacia
// arriba a pantalla completa. La diferencia de peso entre 1024 y 1280 son
// ~30 KB por foto; no vale la pena ahorrarlos.
//
// Por qué WebP y no AVIF: `canvas.toBlob('image/avif')` NO existe como encoder
// en Chrome ni en Safari. AVIF se lee en todas partes pero escribirlo desde el
// navegador necesita un encoder WASM de ~1 MB. WebP es nativo desde Safari 14
// y para una foto la diferencia real son unos pocos KB.

export const FOTO_RATIO = 16 / 9
export const FOTO_ANCHO_MAX = 1280
export const FOTO_CALIDAD = 0.82

/**
 * Lado del avatar guardado.
 *
 * Se ve como máximo a 56 px (la ficha del jugador); en la lista de miembros,
 * a 32. Con DPR 3 eso son 168 píxeles físicos, así que 256 sobra y deja
 * margen. Antes se guardaban a 800 px en PNG con transparencia: cerca de
 * 700 KB por jugador para pintarlos del tamaño de una moneda, y con 38
 * miembros eso es la mitad del storage del plan gratis.
 */
export const AVATAR_LADO = 256
export const AVATAR_CALIDAD = 0.85

/** Región de la imagen original que se conserva, en píxeles de la original. */
export interface AreaRecorte {
  x: number
  y: number
  width: number
  height: number
}

export interface FotoProcesada {
  blob: Blob
  tipo: string
  ancho: number
  alto: number
}

/**
 * El área más grande con la relación pedida que cabe en la imagen, centrada.
 * Es el encuadre con el que se abre el recortador: quien tenga afán da un
 * toque en "Usar así" y no mueve nada.
 */
export function encuadreInicial(ancho: number, alto: number, ratio = FOTO_RATIO): AreaRecorte {
  if (!(ancho > 0) || !(alto > 0) || !(ratio > 0)) return { x: 0, y: 0, width: 0, height: 0 }
  const ratioImagen = ancho / alto
  // Imagen más ancha que el objetivo → sobra a los lados, el alto manda.
  const w = ratioImagen > ratio ? alto * ratio : ancho
  const h = ratioImagen > ratio ? alto : ancho / ratio
  return { x: (ancho - w) / 2, y: (alto - h) / 2, width: w, height: h }
}

/**
 * Tamaño de salida para un recorte dado.
 *
 * Nunca agranda: si alguien sube una foto de 600 px, sale de 600, no estirada
 * a 1280. Estirar solo suma peso e inventa píxeles que no existen.
 */
export function tamanoSalida(anchoRecorte: number, ratio = FOTO_RATIO, anchoMax = FOTO_ANCHO_MAX) {
  const ancho = Math.max(1, Math.round(Math.min(anchoRecorte, anchoMax)))
  return { ancho, alto: Math.max(1, Math.round(ancho / ratio)) }
}

/** Nombre de archivo a partir del tipo MIME que el navegador haya podido dar. */
export function extensionDe(tipo: string): string {
  if (tipo === 'image/webp') return 'webp'
  if (tipo === 'image/png') return 'png'
  return 'jpg'
}

/**
 * Decodifica el archivo RESPETANDO LA ORIENTACIÓN EXIF.
 *
 * Esta es la trampa número uno de estas funciones: las fotos de celular traen
 * una bandera de rotación y el sensor guarda los píxeles sin rotar. Si se
 * dibuja al canvas sin aplicarla, la foto sale acostada 90°.
 *
 * Importa además que sea CONSISTENTE con lo que vio el usuario al recortar: el
 * recortador muestra la imagen ya rotada por el navegador, así que las
 * coordenadas del recorte vienen en ese espacio. Decodificar aquí sin
 * `from-image` daría un recorte corrido sobre una foto acostada.
 */
async function decodificar(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Safari viejo no acepta las opciones. Cae al <img>, que desde Safari
      // 13.1 / Chrome 81 aplica la orientación EXIF al renderizar.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('No se pudo leer la imagen'))
      el.src = url
    })
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** `toBlob` como promesa, que devuelve null en vez de colgarse si falla. */
function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), tipo, calidad))
}

/**
 * Recorta, reduce y comprime. Devuelve siempre algo servible: si el navegador
 * no sabe escribir WebP, sale JPEG, que sabe escribir cualquiera.
 */
export async function recortarYComprimir(
  file: Blob,
  area: AreaRecorte,
  {
    ratio = FOTO_RATIO,
    anchoMax = FOTO_ANCHO_MAX,
    calidad = FOTO_CALIDAD,
    // Con qué salir si el navegador no sabe escribir WebP. Para la foto del
    // partido, JPEG. Para un avatar, PNG: JPEG no tiene canal alpha y
    // rellenaría de negro el fondo que el quitafondos quitó.
    respaldo = 'image/jpeg' as 'image/jpeg' | 'image/png',
  } = {}
): Promise<FotoProcesada> {
  const img = await decodificar(file)
  const { ancho, alto } = tamanoSalida(area.width, ratio, anchoMax)

  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite procesar la imagen')
  // Mejor remuestreo al reducir de 4000 px a 1280.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, ancho, alto)
  if ('close' in img && typeof img.close === 'function') img.close()

  let blob = await aBlob(canvas, 'image/webp', calidad)
  // Chrome devuelve un PNG silenciosamente si no sabe escribir el tipo pedido,
  // así que no basta con que blob exista: hay que mirar qué tipo salió.
  if (!blob || blob.type !== 'image/webp') {
    blob = await aBlob(canvas, respaldo, respaldo === 'image/png' ? 1 : 0.85)
  }
  if (!blob) throw new Error('No se pudo comprimir la imagen')

  return { blob, tipo: blob.type || respaldo, ancho, alto }
}

/**
 * Deja el avatar cuadrado, chico y en WebP.
 *
 * Recorta al cuadrado más grande centrado (una foto de cuerpo entero se
 * quedaba deformada o con franjas dentro del círculo), escala a `lado` y
 * comprime. **Conserva la transparencia**, que es lo que deja el quitafondos:
 * WebP soporta alpha, JPEG no — por eso, si el navegador no supiera escribir
 * WebP, el respaldo es PNG y no JPEG, que rellenaría el fondo de negro.
 *
 * Nunca agranda: una foto ya chica se queda como está.
 */
export async function comprimirAvatar(
  file: Blob,
  lado = AVATAR_LADO,
  calidad = AVATAR_CALIDAD
): Promise<FotoProcesada> {
  const img = await decodificar(file)
  const corte = Math.min(img.width, img.height)
  const destino = Math.max(1, Math.min(corte, Math.round(lado)))

  const canvas = document.createElement('canvas')
  canvas.width = destino
  canvas.height = destino
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite procesar la imagen')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.width - corte) / 2, (img.height - corte) / 2, corte, corte, 0, 0, destino, destino)
  if ('close' in img && typeof img.close === 'function') img.close()

  let blob = await aBlob(canvas, 'image/webp', calidad)
  if (!blob || blob.type !== 'image/webp') blob = await aBlob(canvas, 'image/png', 1)
  if (!blob) throw new Error('No se pudo comprimir la imagen')

  return { blob, tipo: blob.type || 'image/png', ancho: destino, alto: destino }
}

/**
 * Por debajo de esto un avatar ya está optimizado y no se vuelve a tocar.
 *
 * Reencodar es con pérdida: pasar otra vez por el canvas a un archivo que ya
 * está en 256 px WebP solo le quita calidad sin ahorrar nada. El umbral va
 * holgado sobre los ~20 KB que produce `comprimirAvatar`, para que un avatar
 * con más detalle —que sale más pesado siendo igual de correcto— tampoco entre
 * en un segundo ciclo. Es lo que hace que la recompresión masiva se pueda
 * repetir sin degradar nada.
 */
export const AVATAR_YA_OPTIMIZADO = 60 * 1024

/** ¿Vale la pena recomprimir este avatar, o ya está bien? */
export function necesitaRecompresion(bytes: number, tipo?: string | null): boolean {
  if (!Number.isFinite(bytes) || bytes <= 0) return false
  if (bytes > AVATAR_YA_OPTIMIZADO) return true
  // Chico pero todavía PNG: pasarlo a WebP puede bajarlo bastante más.
  return tipo === 'image/png'
}

/**
 * Recorta el avatar al cuadrado que eligió la persona y lo deja listo.
 *
 * Es `recortarYComprimir` con la configuración del avatar: relación 1:1, 256
 * px y respaldo PNG para no perder la transparencia del quitafondos. Se
 * separa `comprimirAvatar` (que recorta al centro por su cuenta) porque aquí
 * el encuadre lo decide quien sube la foto — que es el punto: que la cara
 * quede dentro del círculo.
 */
export function recortarAvatar(file: Blob, area: AreaRecorte): Promise<FotoProcesada> {
  return recortarYComprimir(file, area, {
    ratio: 1, anchoMax: AVATAR_LADO, calidad: AVATAR_CALIDAD, respaldo: 'image/png',
  })
}

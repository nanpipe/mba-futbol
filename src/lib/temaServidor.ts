import { createAdminClient } from '@/lib/supabase/admin'
import { TEMA_KEY, parseTema, esTemaDefault, type Tema } from '@/lib/tema'

// Lee el tema del club para el <style> de layout.tsx y el manifest.
//
// Caché en memoria de 60 s por club, como la del middleware: el layout corre en
// cada página y el tema cambia una vez cada muchos meses. Al guardar,
// `olvidarTemaClub` limpia la de esta instancia; las otras de Vercel tardan lo
// que dure su caché, y el editor lo dice.
//
// Nunca bloquea ni rompe el render: si la lectura falla, sale null y manda
// globals.css, que son los colores de siempre.

const CACHE_MS = 60_000
const cache = new Map<string, { tema: Tema | null; hasta: number }>()

export async function getTemaClub(clubId: string | null): Promise<Tema | null> {
  if (!clubId) return null
  const c = cache.get(clubId)
  if (c && Date.now() < c.hasta) return c.tema
  let tema: Tema | null = null
  try {
    const { data } = await createAdminClient()
      .from('app_settings').select('value').eq('club_id', clubId).eq('key', TEMA_KEY).maybeSingle()
    tema = parseTema((data as { value?: unknown } | null)?.value)
    // El de siempre no se inyecta: así un club que nunca tocó los colores, o
    // que volvió a "Restaurar", queda exactamente con globals.css.
    if (tema && esTemaDefault(tema)) tema = null
  } catch (e) {
    console.error('[tema] no se pudo leer, se usan los colores por defecto:', e)
  }
  cache.set(clubId, { tema, hasta: Date.now() + CACHE_MS })
  return tema
}

export function olvidarTemaClub(clubId: string) {
  cache.delete(clubId)
}

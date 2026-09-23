import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

// POST /api/admin/avatar — reemplaza el avatar de un jugador por una versión
// ya recomprimida.
//
// Existe solo para la recompresión masiva de Ajustes. La compresión la hace el
// NAVEGADOR del superadmin, con la misma `comprimirAvatar` que usa el perfil:
// en el servidor no hay canvas, y una segunda implementación del redimensionado
// se separaría de la primera al primer cambio. Aquí solo se valida y se
// escribe con la service key, que es lo único que el navegador no puede hacer
// sobre la carpeta de otra persona.
//
// Solo superadmin: esto reescribe el archivo de alguien más.

const BUCKET = 'avatars'
// El cliente manda ~20 KB. 512 KB es holgado y a la vez impide que esta ruta
// se use para subir cualquier cosa grande.
const MAX_BYTES = 512 * 1024
const ALLOWED = new Set(['image/webp', 'image/png'])

/**
 * Que los bytes sean de verdad lo que el cliente dice.
 *
 * El `type` de un Blob lo pone quien lo manda, así que por sí solo no prueba
 * nada: se podría declarar `image/webp` y enviar cualquier cosa, que luego
 * quedaría servida desde un bucket público. Mirar la firma del archivo cierra
 * eso y cuesta ocho líneas.
 */
function firmaValida(b: Buffer, tipo: string): boolean {
  if (tipo === 'image/png') {
    return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  }
  if (tipo === 'image/webp') {
    // "RIFF" …4 bytes de tamaño… "WEBP"
    return b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP'
  }
  return false
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin
    .from('profiles').select('role, username, club_id').eq('id', user.id).single()
  const yo = prof as { role?: string; username?: string; club_id?: string } | null
  if (yo?.role !== 'superadmin') return NextResponse.json({ error: 'Solo superadmin' }, { status: 403 })
  const clubId = yo.club_id
  if (!clubId) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Form inválido' }, { status: 400 }) }

  const player_id = form.get('player_id')
  const file = form.get('file')
  if (typeof player_id !== 'string' || !isUUID(player_id)) {
    return NextResponse.json({ error: 'player_id inválido' }, { status: 400 })
  }
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Archivo faltante' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'Archivo vacío' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Imagen muy grande' }, { status: 400 })
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Formato no permitido' }, { status: 400 })

  // El jugador tiene que ser de este club. Sin esto, un superadmin podría
  // reescribir el avatar de cualquiera de otro club.
  const { data: destino } = await admin
    .from('profiles').select('id, avatar_url').eq('club_id', clubId).eq('id', player_id).maybeSingle()
  if (!destino) return NextResponse.json({ error: 'Jugador no encontrado' }, { status: 404 })

  // Se escribe SOBRE el mismo objeto, igual que el perfil: la ruta histórica
  // es `<uid>/avatar.png` aunque el contenido ya sea WebP. Cambiar el nombre
  // dejaría el archivo viejo ocupando espacio, que es justo lo que esto viene
  // a recuperar. Manda el content-type, no la extensión.
  const ruta = `${player_id}/avatar.png`
  const buffer = Buffer.from(await file.arrayBuffer())
  if (!firmaValida(buffer, file.type)) {
    return NextResponse.json({ error: 'El archivo no es una imagen válida' }, { status: 400 })
  }
  const { error: upErr } = await admin.storage
    .from(BUCKET).upload(ruta, buffer, { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: `Error subiendo: ${upErr.message}` }, { status: 500 })

  // La URL no cambia, así que sin `?t=` los navegadores (y el service worker)
  // seguirían sirviendo el archivo viejo de la caché.
  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(ruta)
  const url = `${publicUrl}?t=${Date.now()}`
  const { error: updErr } = await admin
    .from('profiles').update({ avatar_url: url }).eq('club_id', clubId).eq('id', player_id)
  if (updErr) return NextResponse.json({ error: 'Error guardando URL' }, { status: 500 })

  await logActivity({
    user_id: user.id, username: yo.username, accion: 'recomprimir_avatar',
    detalles: { player_id, bytes: file.size, tipo: file.type },
  })
  return NextResponse.json({ ok: true, avatar_url: url, bytes: file.size })
}

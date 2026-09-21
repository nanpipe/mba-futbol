import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

// El cliente recorta a 16:9, reduce a 1280 px y pasa a WebP antes de subir
// (`lib/imagen.ts`), así que lo que llega aquí pesa ~150 KB. El tope se deja en
// 3 MB y no en 8: el navegador no es de fiar — quien se lo salte no debería
// poder llenar el storage igual que antes — pero un cliente con caché vieja,
// que todavía mande la foto cruda, tiene que poder terminar su subida.
const MAX_BYTES = 3 * 1024 * 1024 // 3 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

// POST /api/admin/foto — multipart upload of a match photo.
// Uploads with the service-role client (bypasses storage RLS) so admins never
// hit "new row violates row-level security policy" on the bucket.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: prof } = await admin.from('profiles').select('role, username, club_id').eq('id', user.id).single()
  const role = (prof as { role?: string })?.role
  if (role !== 'admin' && role !== 'superadmin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const clubId = (prof as { club_id?: string })?.club_id
  if (!clubId) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Form inválido' }, { status: 400 }) }

  const partido_id = form.get('partido_id')
  const file = form.get('file')
  if (typeof partido_id !== 'string' || !isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Archivo faltante' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Imagen muy grande (máx 3 MB). Si la app está desactualizada, ciérrala y vuelve a abrirla.' }, { status: 400 })
  if (file.type && !ALLOWED.has(file.type)) return NextResponse.json({ error: 'Formato no permitido' }, { status: 400 })

  // Partido must belong to the admin's club
  const { data: partido } = await admin.from('partidos').select('id').eq('id', partido_id).eq('club_id', clubId).single()
  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const path = `${partido_id}/foto-${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await admin.storage
    .from('match-photos')
    .upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: true })
  if (upErr) return NextResponse.json({ error: `Error subiendo foto: ${upErr.message}` }, { status: 500 })

  const { data: { publicUrl } } = admin.storage.from('match-photos').getPublicUrl(path)

  const { error: updErr } = await admin.from('partidos').update({ foto_url: publicUrl }).eq('id', partido_id).eq('club_id', clubId)
  if (updErr) return NextResponse.json({ error: 'Error guardando URL' }, { status: 500 })

  // Borrar las fotos anteriores de este partido.
  //
  // El nombre lleva timestamp para romper cachés, así que `upsert` NO reemplaza
  // nada: cada resubida creaba un archivo nuevo y el viejo quedaba ocupando
  // espacio para siempre, sin que nada lo apuntara. Se limpia DESPUÉS de que la
  // nueva quedó guardada y referenciada, para no dejar el partido sin foto si
  // algo falla en el camino. Que falle el borrado no es motivo para fallar la
  // subida: la foto ya está bien, esto solo recupera espacio.
  try {
    const { data: previas } = await admin.storage.from('match-photos').list(partido_id)
    const sobran = (previas ?? [])
      .map(o => `${partido_id}/${o.name}`)
      .filter(p => p !== path)
    if (sobran.length > 0) await admin.storage.from('match-photos').remove(sobran)
  } catch (e) {
    console.error('[foto] no se pudieron borrar las fotos previas', e)
  }

  await logActivity({ user_id: user.id, username: (prof as { username?: string })?.username, accion: 'guardar_foto_partido', detalles: { partido_id } })
  return NextResponse.json({ ok: true, foto_url: publicUrl })
}

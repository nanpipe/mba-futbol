import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
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
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Imagen muy grande (máx 8 MB)' }, { status: 400 })
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

  await logActivity({ user_id: user.id, username: (prof as { username?: string })?.username, accion: 'guardar_foto_partido', detalles: { partido_id } })
  return NextResponse.json({ ok: true, foto_url: publicUrl })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeError, isString } from '@/lib/validation'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

function getIP(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}

// PATCH /api/perfil — player updates their own profile (username, avatar_url)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Guard: player must be approved
  const { data: currentProfile } = await admin
    .from('profiles')
    .select('username, aprobado, role')
    .eq('id', user.id)
    .single()

  if (!currentProfile?.aprobado && currentProfile?.role !== 'admin' && currentProfile?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Cuenta pendiente de aprobación' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { avatar_url, posicion, username } = body
  const ip = getIP(req)
  const updates: Record<string, string> = {}

  // ── Username ──────────────────────────────────────────────────────────────
  if (username !== undefined) {
    // Check setting
    const { data: unSetting } = await admin
      .from('app_settings').select('value').eq('key', 'usuarios_pueden_cambiar_username').maybeSingle()
    const canChange = unSetting !== null && (unSetting as { value: unknown })?.value === true
    if (!canChange) {
      return NextResponse.json({ error: 'El club no permite cambiar el nombre de usuario.' }, { status: 403 })
    }
    if (!isString(username, 3, 30)) {
      return NextResponse.json({ error: 'Username debe tener entre 3 y 30 caracteres.' }, { status: 400 })
    }
    const clean = (username as string).trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (clean.length < 3) {
      return NextResponse.json({ error: 'Username solo puede contener letras, números y guiones bajos.' }, { status: 400 })
    }
    // Check uniqueness
    const { data: existing } = await admin
      .from('profiles').select('id').eq('username', clean).maybeSingle()
    if (existing && (existing as { id: string }).id !== user.id) {
      return NextResponse.json({ error: 'Ese nombre de usuario ya está en uso.' }, { status: 409 })
    }
    updates.username = clean
  }

  // ── Posición ──────────────────────────────────────────────────────────────
  const POSICIONES = ['portero', 'defensa', 'medio', 'delantero', 'cualquiera']
  if (posicion !== undefined) {
    if (typeof posicion !== 'string' || !POSICIONES.includes(posicion)) {
      return NextResponse.json({ error: 'Posición inválida.' }, { status: 400 })
    }
    updates.posicion = posicion
  }

  // ── Avatar URL ────────────────────────────────────────────────────────────
  if (avatar_url !== undefined) {
    if (!isString(avatar_url, 1, 2048)) {
      return NextResponse.json({ error: 'URL de avatar inválida.' }, { status: 400 })
    }
    try {
      const parsed = new URL(avatar_url as string)
      // Only allow Supabase storage URLs for security
      if (!parsed.hostname.endsWith('.supabase.co')) {
        return NextResponse.json({ error: 'Solo se permiten imágenes de Supabase Storage.' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'URL de avatar inválida.' }, { status: 400 })
    }
    updates.avatar_url = avatar_url as string
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nada que actualizar.' }, { status: 400 })
  }

  const { error } = await admin.from('profiles').update(updates).eq('id', user.id)
  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })

  await logActivity({
    user_id: user.id,
    username: (currentProfile as { username?: string })?.username,
    accion: 'actualizar_perfil',
    detalles: { fields: Object.keys(updates) },
    ip,
  })

  return NextResponse.json({ ok: true, mensaje: 'Perfil actualizado.' })
}

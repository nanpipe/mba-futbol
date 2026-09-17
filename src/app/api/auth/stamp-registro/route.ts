import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientIp } from '@/lib/rateLimit'
import { getClubId } from '@/lib/club'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/stamp-registro — sin cuerpo.
 *
 * Sella en el perfil recién creado los dos datos que antes mandaba el navegador
 * dentro del metadata de signUp:
 *
 *   ip_registro → la IP que pone el proxy, no la que dice el cliente
 *   club_id     → el club que resolvió el middleware por el dominio
 *
 * Solo escribe sobre el usuario de la sesión, y solo mientras ip_registro siga
 * NULL: eso lo vuelve de un solo uso, así que nadie puede re-sellarse con otra
 * IP más tarde ni pisarle el registro a otro.
 *
 * Si el club exige confirmar el correo, signUp no deja sesión y esta llamada no
 * hace nada: el perfil se queda sin IP. Preferimos un perfil sin IP a uno con
 * una IP inventada — el admin ve el hueco, y la regla de una cuenta por IP
 * nunca valida contra un dato falso.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, razon: 'sin_sesion' })

  const admin = createAdminClient()
  const ip = getClientIp(req)
  const clubId = getClubId(req)

  const patch: Record<string, string> = { club_id: clubId }
  if (ip !== 'unknown') patch.ip_registro = ip

  // .is('ip_registro', null) es el candado: la fila solo se deja sellar una vez.
  const { data, error } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .is('ip_registro', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[stamp-registro] update failed:', error.message)
    return NextResponse.json({ ok: false, razon: 'error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sellado: Boolean(data) })
}

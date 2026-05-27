import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Server-side activity logger — writes to the activity_log table via the
 * service_role key so it bypasses RLS. Never throws; logging must never
 * crash the main request flow.
 *
 * club_id is required (NOT NULL). If not supplied, it is auto-derived from
 * the user's profile. Calls with no user and no club_id are silently dropped.
 */
export async function logActivity({
  user_id,
  username,
  accion,
  detalles,
  ip,
  club_id,
}: {
  user_id?: string | null
  username?: string | null
  accion: string
  detalles?: Record<string, unknown>
  ip?: string | null
  club_id?: string | null
}) {
  try {
    const admin = createAdminClient()

    let resolvedClubId = club_id ?? null

    // Auto-resolve club_id from the user's profile when not provided
    if (!resolvedClubId && user_id) {
      const { data: prof } = await admin
        .from('profiles')
        .select('club_id')
        .eq('id', user_id)
        .single()
      resolvedClubId = (prof as { club_id?: string } | null)?.club_id ?? null
    }

    // Cannot write without club_id (NOT NULL constraint) — skip silently
    if (!resolvedClubId) return

    await admin.from('activity_log').insert({
      club_id: resolvedClubId,
      user_id: user_id ?? null,
      username: username ?? null,
      accion,
      detalles: detalles ?? null,
      ip: ip ?? null,
    })
  } catch {
    // Silently swallow — logging must never break the caller
  }
}

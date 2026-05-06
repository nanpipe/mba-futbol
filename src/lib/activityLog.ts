import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Server-side activity logger — writes to the activity_log table via the
 * service_role key so it bypasses RLS. Never throws; logging must never
 * crash the main request flow.
 */
export async function logActivity({
  user_id,
  username,
  accion,
  detalles,
  ip,
}: {
  user_id?: string | null
  username?: string | null
  accion: string
  detalles?: Record<string, unknown>
  ip?: string | null
}) {
  try {
    const admin = createAdminClient()
    await admin.from('activity_log').insert({
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

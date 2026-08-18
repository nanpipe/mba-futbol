import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubId } from '@/lib/club'
import { parseTiers, TIERS_SETTING_KEY } from '@/lib/tier'

export const dynamic = 'force-dynamic'

/**
 * GET /api/club
 * Returns club context for client components.
 * Club is resolved by middleware from subdomain and injected as x-club-id header.
 */
// Schedule/days are derived from real matches, not stored as text.
// Only club-policy values that aren't derivable live here.
const SCHEDULE_SETTINGS_DEFAULTS: Record<string, string> = {
  hora_promo_invitados: '2:00 PM',
  // Mirrored so the guest UI shows the same limit the API enforces.
  max_invitados: '3',
}

export async function GET(req: NextRequest) {
  const clubId = getClubId(req)
  const admin = createAdminClient()

  const [{ data: club, error }, { data: settingsRows }] = await Promise.all([
    admin
      .from('clubs')
      .select('id, nombre, slug, timezone, plan, subscription_status, ciudad, logo_url, color_primary, dias_juego, hora_default, hora_apertura_default, dias_antes_apertura_default')
      .eq('id', clubId)
      .single(),
    admin
      .from('app_settings')
      .select('key, value')
      .eq('club_id', clubId)
      .in('key', [...Object.keys(SCHEDULE_SETTINGS_DEFAULTS), TIERS_SETTING_KEY]),
  ])

  if (error || !club) {
    return NextResponse.json({ error: 'Club no encontrado' }, { status: 404 })
  }

  const settings: Record<string, string> = { ...SCHEDULE_SETTINGS_DEFAULTS }
  let tiersRaw: unknown = null
  for (const row of settingsRows ?? []) {
    const r = row as { key: string; value: unknown }
    if (r.key === TIERS_SETTING_KEY) { tiersRaw = r.value; continue }
    if (typeof r.value === 'string') settings[r.key] = r.value
  }

  return NextResponse.json({ club, settings, tiers: parseTiers(tiersRaw) })
}

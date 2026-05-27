import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubId } from '@/lib/club'

export const dynamic = 'force-dynamic'

/**
 * GET /api/club
 * Returns club context for client components.
 * Club is resolved by middleware from subdomain and injected as x-club-id header.
 */
const SCHEDULE_SETTINGS_DEFAULTS: Record<string, string> = {
  hora_partido: '7:00 PM',
  hora_apertura_martes: 'domingos a las 10:00 am',
  hora_apertura_viernes: 'jueves a las 10:00 am',
  dia_juego_1: 'martes',
  dia_juego_2: 'viernes',
  dia_apertura_1: 'domingo',
  dia_apertura_2: 'jueves',
  hora_promo_invitados: '2:00 PM',
  dias_display: 'MAR · VIE',
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
      .in('key', Object.keys(SCHEDULE_SETTINGS_DEFAULTS)),
  ])

  if (error || !club) {
    return NextResponse.json({ error: 'Club no encontrado' }, { status: 404 })
  }

  const settings: Record<string, string> = { ...SCHEDULE_SETTINGS_DEFAULTS }
  for (const row of settingsRows ?? []) {
    const r = row as { key: string; value: unknown }
    if (typeof r.value === 'string') settings[r.key] = r.value
  }

  return NextResponse.json({ club, settings })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubId } from '@/lib/club'

export const dynamic = 'force-dynamic'

/**
 * GET /api/club
 * Returns club context for client components.
 * Club is resolved by middleware from subdomain and injected as x-club-id header.
 */
export async function GET(req: NextRequest) {
  const clubId = getClubId(req)
  const admin = createAdminClient()

  const { data: club, error } = await admin
    .from('clubs')
    .select('id, nombre, slug, timezone, plan, subscription_status, ciudad, logo_url, color_primary, dias_juego, hora_default, hora_apertura_default, dias_antes_apertura_default')
    .eq('id', clubId)
    .single()

  if (error || !club) {
    return NextResponse.json({ error: 'Club no encontrado' }, { status: 404 })
  }

  return NextResponse.json({ club })
}

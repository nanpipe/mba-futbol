import { NextRequest } from 'next/server'

export const MBAFC_CLUB_ID = 'a0000000-0000-0000-0000-000000000001'

/**
 * Read club_id injected by middleware.
 * Falls back to MBA FC in dev/missing-header scenarios.
 * Use in API route handlers: getClubId(req)
 */
export function getClubId(req: NextRequest): string {
  return req.headers.get('x-club-id') ?? MBAFC_CLUB_ID
}

export function getClubSlug(req: NextRequest): string {
  return req.headers.get('x-club-slug') ?? 'mbafc'
}

export function getClubSubscriptionStatus(req: NextRequest): string {
  return req.headers.get('x-club-status') ?? 'active'
}

/**
 * Guard: block request if club subscription is not active.
 * Use in routes that require an active plan.
 */
export function isClubActive(req: NextRequest): boolean {
  const status = getClubSubscriptionStatus(req)
  return status === 'active' || status === 'trialing'
}

import { NextResponse } from 'next/server'

// GET /api/health — uptime check (no DB dependency, no version info)
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

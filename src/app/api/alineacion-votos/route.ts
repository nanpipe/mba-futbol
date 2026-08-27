import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID, safeError } from '@/lib/validation'

export const dynamic = 'force-dynamic'

const MAX_COMENTARIO = 200

async function getCaller() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: prof } = await admin
    .from('profiles').select('club_id, role, aprobado').eq('id', user.id).single()
  if (!prof?.club_id || !prof.aprobado) return null
  const role = (prof as { role?: string }).role
  return {
    admin, user,
    clubId: prof.club_id as string,
    isAdmin: role === 'admin' || role === 'superadmin',
  }
}

// GET /api/alineacion-votos?partido_id=xxx
// Players get the counts plus their own vote. Admins also get the comments, so
// they can act on them while reviewing the draft.
export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: partido } = await caller.admin
    .from('partidos').select('id').eq('id', partido_id).eq('club_id', caller.clubId).maybeSingle()
  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  const { data: votos } = await caller.admin
    .from('alineacion_votos')
    .select('player_id, voto, comentario, profiles!player_id(username)')
    .eq('partido_id', partido_id)
    .order('created_at', { ascending: true })

  const rows = (votos ?? []) as unknown as {
    player_id: string; voto: number; comentario: string | null; profiles: { username: string } | null
  }[]

  const aFavor = rows.filter(v => v.voto === 1).length
  const enContra = rows.filter(v => v.voto === -1).length
  const mio = rows.find(v => v.player_id === caller.user.id) ?? null

  // How many could vote at all — gives the tally a denominator.
  const { count: totalConfirmados } = await caller.admin
    .from('inscripciones').select('id', { count: 'exact', head: true })
    .eq('partido_id', partido_id).eq('estado', 'confirmado')

  return NextResponse.json({
    ok: true,
    aFavor,
    enContra,
    total: totalConfirmados ?? 0,
    miVoto: mio ? { voto: mio.voto, comentario: mio.comentario } : null,
    // Comments are admin-only: they name other players and are meant for
    // whoever is fixing the lineup, not for the dressing room.
    comentarios: caller.isAdmin
      ? rows.filter(v => v.voto === -1).map(v => ({
          username: v.profiles?.username ?? '?',
          comentario: v.comentario ?? '',
        }))
      : undefined,
  })
}

// POST /api/alineacion-votos — cast or change your vote
export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: { partido_id?: unknown; voto?: unknown; comentario?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  if (!isUUID(body.partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })
  if (body.voto !== 1 && body.voto !== -1) return NextResponse.json({ error: 'Voto inválido' }, { status: 400 })

  const partido_id = body.partido_id as string

  const { data: partido } = await caller.admin
    .from('partidos').select('id, equipos_confirmados').eq('id', partido_id).eq('club_id', caller.clubId).maybeSingle()
  if (!partido) return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })

  // Once the admin has confirmed, the lineup is settled — no point collecting
  // opinions on it any more.
  if ((partido as { equipos_confirmados?: boolean }).equipos_confirmados) {
    return NextResponse.json({ error: 'Los equipos ya fueron confirmados.' }, { status: 409 })
  }

  // Only someone actually playing gets a say.
  const { data: ins } = await caller.admin
    .from('inscripciones').select('id')
    .eq('partido_id', partido_id).eq('player_id', caller.user.id).eq('estado', 'confirmado')
    .maybeSingle()
  if (!ins) return NextResponse.json({ error: 'No estás confirmado en este partido.' }, { status: 403 })

  const comentario = typeof body.comentario === 'string' && body.comentario.trim()
    ? body.comentario.trim().slice(0, MAX_COMENTARIO)
    : null

  const { error } = await caller.admin.from('alineacion_votos').upsert({
    club_id: caller.clubId,
    partido_id,
    player_id: caller.user.id,
    voto: body.voto,
    comentario: body.voto === -1 ? comentario : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'partido_id,player_id' })

  if (error) return NextResponse.json({ error: safeError(error) }, { status: 500 })
  return NextResponse.json({ ok: true })
}

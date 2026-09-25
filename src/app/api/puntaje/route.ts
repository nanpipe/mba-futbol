import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubBadges } from '@/lib/categorias'
import { getQuorum, getThumbsPaso, getCastigoNoVotar } from '@/lib/reconocimientos'
import { getFaltasGap } from '@/lib/faltas'
import { STEP, CAP_NORMAL, CAP_MINI, MIN_RATING, MAX_RATING, BASE_RATING } from '@/lib/puntaje'

export const dynamic = 'force-dynamic'

// GET /api/puntaje — las reglas con las que se mueve el rating, para /puntaje.
//
// Los umbrales son configurables por club y viven en `app_settings`, que el
// navegador no lee. Si la pantalla de reglas los trajera escritos a mano, el
// día que el admin suba "pulgares por escalón" de 3 a 4 la pantalla seguiría
// enseñando la regla vieja — y esa pantalla existe justamente para que la gente
// deje de adivinar cómo se calcula su puntaje.
//
// Todo lo que sale de acá ya es público dentro del club (los reconocimientos se
// ven en cada partido, el quórum se explica en la votación). El club sale del
// perfil del usuario, nunca de un parámetro.

export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: perfil } = await admin
    .from('profiles').select('club_id, aprobado, role, habilidad').eq('id', user.id).single()
  const p = perfil as { club_id?: string | null; aprobado?: boolean; role?: string; habilidad?: number | null } | null
  const clubId = p?.club_id
  if (!clubId) return NextResponse.json({ error: 'Club no encontrado' }, { status: 403 })
  if (!p?.aprobado && p?.role !== 'admin' && p?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Cuenta pendiente de aprobación' }, { status: 403 })
  }

  const [badges, thumbsPaso, faltasGap, castigo, quorum] = await Promise.all([
    getClubBadges(admin, clubId),
    getThumbsPaso(admin, clubId),
    getFaltasGap(admin, clubId),
    getCastigoNoVotar(admin, clubId),
    getQuorum(admin, clubId),
  ])

  return NextResponse.json({
    ok: true,
    reglas: {
      step: STEP,
      capNormal: CAP_NORMAL,
      capMini: CAP_MINI,
      minRating: MIN_RATING,
      maxRating: MAX_RATING,
      baseRating: BASE_RATING,
      thumbsPaso,
      faltasGap,
    },
    castigo,
    quorum,
    // Solo los que mueven el puntaje: un reconocimiento neutral no entra en la
    // cuenta y ponerlo en el simulador haría creer que sí.
    badges: badges.filter(b => b.signo !== 'neutral'),
    mi_puntaje: typeof p.habilidad === 'number' ? p.habilidad : BASE_RATING,
  })
}

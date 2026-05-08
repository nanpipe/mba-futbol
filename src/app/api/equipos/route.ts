import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/validation'
import { balancearEquipos, type JugadorEquipo } from '@/lib/teamBalancer'
import { logActivity } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

async function getAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: p } = await supabase.from('profiles').select('role, username').eq('id', user.id).single()
  if (p?.role !== 'admin') return null
  return { ...user, username: (p as { username?: string })?.username ?? 'admin' }
}

// GET /api/equipos?partido_id=xxx — returns saved teams (any authenticated user)
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const partido_id = req.nextUrl.searchParams.get('partido_id')
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  const { data: equipos } = await admin
    .from('equipos')
    .select('id, nombre, confirmado')
    .eq('partido_id', partido_id)

  if (!equipos || equipos.length === 0) return NextResponse.json({ ok: true, equipos: null })

  const { data: jugadores } = await admin
    .from('equipo_jugadores')
    .select('equipo_id, player_id, profiles(id, username, avatar_url, posicion, habilidad)')
    .in('equipo_id', equipos.map(e => e.id))

  const byEquipo: Record<string, JugadorEquipo[]> = {}
  for (const row of (jugadores ?? [])) {
    const prof = (row as unknown as { profiles: JugadorEquipo }).profiles
    if (!byEquipo[row.equipo_id]) byEquipo[row.equipo_id] = []
    byEquipo[row.equipo_id].push(prof)
  }

  return NextResponse.json({
    ok: true,
    equipos: equipos.map(e => ({
      ...e,
      jugadores: byEquipo[e.id] ?? [],
    })),
  })
}

// POST /api/equipos — admin actions
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const adminUser = await getAdminUser(supabase)
  if (!adminUser) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const { accion, partido_id } = body
  if (!isUUID(partido_id)) return NextResponse.json({ error: 'partido_id inválido' }, { status: 400 })

  // ── balancear: Gemini AI → fallback snake-draft ────────────────────────────
  if (accion === 'balancear') {
    const [{ data: ins }, { data: invs }, { data: knowledge }, { data: feedbackRows }] = await Promise.all([
      admin
        .from('inscripciones')
        .select('player_id, profiles(id, username, avatar_url, posicion, habilidad)')
        .eq('partido_id', partido_id as string)
        .eq('estado', 'confirmado'),
      admin
        .from('invitados')
        .select('id, nombre')
        .eq('partido_id', partido_id as string)
        .eq('estado', 'confirmado'),
      admin
        .from('player_knowledge')
        .select('username, skill_override, roles, traits, notes'),
      admin
        .from('balancer_feedback')
        .select('feedback, created_at')
        .order('created_at', { ascending: true }),
    ])

    const jugadores: JugadorEquipo[] = (ins ?? [])
      .map(i => (i as unknown as { profiles: JugadorEquipo }).profiles)
      .filter(Boolean)

    // Add confirmed invitados as pseudo-players
    for (const inv of invs ?? []) {
      jugadores.push({
        id: (inv as { id: string }).id,
        username: `${(inv as { nombre: string }).nombre} *`,
        avatar_url: null,
        posicion: 'cualquiera',
        habilidad: 3.0,
        isInvitado: true,
      })
    }

    // ── Try Gemini AI balancer ─────────────────────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY
    let fallbackReason = !geminiKey ? 'GEMINI_API_KEY no configurada' : ''
    if (geminiKey && jugadores.length >= 2) {
      try {
        // Build knowledge map by username
        type KnowledgeRow = { username: string; skill_override: string; roles: string[]; traits: string[]; notes: string }
        const km: Record<string, KnowledgeRow> = {}
        for (const k of (knowledge ?? []) as KnowledgeRow[]) km[k.username] = k

        // Player list for prompt
        const playerLines = jugadores.map(j => {
          const k = km[j.username.replace(' *', '')]
          const skillLabel = k?.skill_override ?? 'unknown'
          const roles = k?.roles?.length ? k.roles.join(', ') : j.posicion
          const traits = k?.traits?.length ? ` | rasgos: ${k.traits.join(', ')}` : ''
          const notes = k?.notes ? ` | notas: "${k.notes}"` : ''
          const invTag = j.isInvitado ? ' [INVITADO]' : ''
          return `• ${j.username}${invTag} — habilidad: ${j.habilidad.toFixed(1)}, skill: ${skillLabel}, roles: ${roles}${traits}${notes}`
        }).join('\n')

        // Feedback context
        type FeedbackRow = { feedback: string; created_at: string }
        const feedbackLines = (feedbackRows as FeedbackRow[] ?? []).length > 0
          ? (feedbackRows as FeedbackRow[]).map(f =>
              `[${new Date(f.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}] ${f.feedback}`
            ).join('\n')
          : 'Sin feedback previo.'

        const prompt = `Eres el organizador de equipos del MBA Fútbol Club. Divide los jugadores disponibles en dos equipos balanceados y competitivos.

=== CONTEXTO APRENDIDO (feedback histórico del administrador) ===
${feedbackLines}

=== JUGADORES DISPONIBLES HOY (${jugadores.length} jugadores) ===
${playerLines}

=== INSTRUCCIONES ===
1. Crea Equipo A y Equipo B lo más balanceados posible en habilidad total y distribución de posiciones
2. Respeta ESTRICTAMENTE el feedback histórico (relaciones, conflictos, preferencias)
3. Si hay porteros disponibles, asigna al menos uno por equipo cuando sea posible
4. Para jugadores sin datos cualitativos, usa el valor numérico de habilidad
5. Introduce variedad natural — no siempre el mismo resultado para los mismos jugadores

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown:
{"equipoA":["username1","username2"],"equipoB":["username3","username4"],"razon":"Explicación clave en máx 200 caracteres"}`

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
            }),
            signal: AbortSignal.timeout(15000),
          }
        )

        if (!geminiRes.ok) {
          const errBody = await geminiRes.text().catch(() => '')
          throw new Error(`Gemini HTTP ${geminiRes.status}: ${errBody.slice(0, 200)}`)
        }

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json()
          const rawText: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          // Strip markdown fences if present
          const jsonText = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
          const parsed = JSON.parse(jsonText)

          // Map usernames → JugadorEquipo objects
          const byUsername = Object.fromEntries(jugadores.map(j => [j.username, j]))
          const equipoA: JugadorEquipo[] = (parsed.equipoA ?? [])
            .map((u: string) => byUsername[u] ?? byUsername[u + ' *'])
            .filter(Boolean)
          const equipoB: JugadorEquipo[] = (parsed.equipoB ?? [])
            .map((u: string) => byUsername[u] ?? byUsername[u + ' *'])
            .filter(Boolean)

          // Safety: assign any player Gemini missed to the smaller team
          const assigned = new Set([...equipoA, ...equipoB].map(j => j.id))
          for (const j of jugadores) {
            if (!assigned.has(j.id)) {
              equipoA.length <= equipoB.length ? equipoA.push(j) : equipoB.push(j)
            }
          }

          return NextResponse.json({
            ok: true, equipoA, equipoB,
            razon: (parsed.razon as string) ?? '',
            source: 'gemini',
          })
        }
      } catch (err) {
        fallbackReason = err instanceof Error ? err.message : String(err)
        console.error('[balancear] Gemini error, falling back to snake-draft:', fallbackReason)
      }
    }

    // ── Fallback: deterministic snake-draft ───────────────────────────────
    const { equipoA, equipoB } = balancearEquipos(jugadores)
    return NextResponse.json({ ok: true, equipoA, equipoB, razon: '', source: 'fallback', fallbackReason })
  }

  // ── guardar: save (or overwrite) teams in DB ──────────────────────────────
  if (accion === 'guardar') {
    const { equipoA, equipoB } = body as {
      equipoA: { id: string }[]
      equipoB: { id: string }[]
    }

    // Delete existing teams for this match
    await admin.from('equipos').delete().eq('partido_id', partido_id as string)

    // Create team A
    const { data: tA } = await admin.from('equipos').insert({ partido_id, nombre: 'A' }).select().single()
    // Create team B
    const { data: tB } = await admin.from('equipos').insert({ partido_id, nombre: 'B' }).select().single()

    if (!tA || !tB) return NextResponse.json({ error: 'Error creando equipos' }, { status: 500 })

    // Fetch invitado IDs for this partido to exclude them (no profiles FK)
    const { data: invitadosIds } = await admin
      .from('invitados')
      .select('id')
      .eq('partido_id', partido_id as string)
    const invSet = new Set((invitadosIds ?? []).map((i: { id: string }) => i.id))

    const rowsA = (equipoA ?? [])
      .filter((p: { id: string }) => !invSet.has(p.id))
      .map((p: { id: string }) => ({ equipo_id: tA.id, player_id: p.id }))
    const rowsB = (equipoB ?? [])
      .filter((p: { id: string }) => !invSet.has(p.id))
      .map((p: { id: string }) => ({ equipo_id: tB.id, player_id: p.id }))

    if (rowsA.length) await admin.from('equipo_jugadores').insert(rowsA)
    if (rowsB.length) await admin.from('equipo_jugadores').insert(rowsB)

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'guardar_equipos', detalles: { partido_id, totalA: rowsA.length, totalB: rowsB.length } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos guardados como borrador.' })
  }

  // ── confirmar: lock teams + send push ─────────────────────────────────────
  if (accion === 'confirmar') {
    const { data: equipos } = await admin
      .from('equipos')
      .select('id, nombre')
      .eq('partido_id', partido_id as string)

    if (!equipos || equipos.length < 2) {
      return NextResponse.json({ error: 'Primero guarda los equipos.' }, { status: 400 })
    }

    // Mark confirmed
    await admin.from('equipos').update({ confirmado: true }).eq('partido_id', partido_id as string)
    await admin.from('partidos').update({ equipos_confirmados: true }).eq('id', partido_id as string)

    // Get player lists for notifications
    const { data: jAll } = await admin
      .from('equipo_jugadores')
      .select('equipo_id, player_id, profiles(username)')
      .in('equipo_id', equipos.map(e => e.id))

    const nombresPorEquipo: Record<string, string[]> = { A: [], B: [] }
    for (const row of (jAll ?? [])) {
      const eq = equipos.find(e => e.id === row.equipo_id)
      const username = (row as unknown as { profiles: { username: string } }).profiles?.username ?? ''
      if (eq) nombresPorEquipo[eq.nombre]?.push(username)
    }

    // Push notifications
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, player_id')
      .in('player_id', (jAll ?? []).map(r => r.player_id))

    const { sendPush } = await import('@/lib/push')
    for (const sub of (subs ?? [])) {
      const equipo = (jAll ?? []).find(j => j.player_id === sub.player_id)
      const nombreEq = equipos.find(e => e.id === equipo?.equipo_id)?.nombre ?? '?'
      await sendPush(sub, {
        title: `⚽ Equipo ${nombreEq} confirmado`,
        body: `Juegas en el Equipo ${nombreEq}. Revisa la alineación en la app.`,
        url: '/',
      }).catch(() => {})
    }

    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'confirmar_equipos', detalles: { partido_id } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos confirmados y jugadores notificados.' })
  }

  // ── resetear: delete teams for a match ────────────────────────────────────
  if (accion === 'resetear') {
    await admin.from('equipos').delete().eq('partido_id', partido_id as string)
    await admin.from('partidos').update({ equipos_confirmados: false }).eq('id', partido_id as string)
    await logActivity({ user_id: adminUser.id, username: adminUser.username, accion: 'resetear_equipos', detalles: { partido_id } })
    return NextResponse.json({ ok: true, mensaje: 'Equipos eliminados.' })
  }

  return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}

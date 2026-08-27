import type { createAdminClient } from '@/lib/supabase/admin'
import { balancearEquipos, type JugadorEquipo } from '@/lib/teamBalancer'

type Admin = ReturnType<typeof createAdminClient>

export interface DraftResult {
  equipoA: JugadorEquipo[]
  equipoB: JugadorEquipo[]
  equipoC?: JugadorEquipo[]
  razon: string
  source: 'gemini' | 'fallback'
  fallbackReason?: string
}

interface Contexto {
  jugadores: JugadorEquipo[]
  esMinitorneo: boolean
  clubNombre: string
  knowledge: KnowledgeRow[]
  feedback: FeedbackRow[]
}

type KnowledgeRow = { username: string; skill_override: string; roles: string[]; traits: string[]; notes: string }
type FeedbackRow = { feedback: string; created_at: string }

const RATING_NEUTRAL = 3.0

/**
 * Everything the balancer needs for one match: confirmed players (with their
 * current rating), confirmed guests as neutral pseudo-players, plus the club's
 * accumulated knowledge and feedback.
 */
export async function cargarContexto(
  admin: Admin,
  partido_id: string,
  clubId: string
): Promise<Contexto> {
  const { data: pTipo } = await admin.from('partidos').select('tipo').eq('id', partido_id).eq('club_id', clubId).maybeSingle()
  const esMinitorneo = (pTipo as { tipo?: string } | null)?.tipo === 'minitorneo'

  const { data: clubRow } = await admin.from('clubs').select('nombre').eq('id', clubId).single()
  const clubNombre = (clubRow as { nombre?: string } | null)?.nombre ?? 'el club'

  const [insRes, invsRes, knowledgeRes, feedbackRes] = await Promise.all([
    admin
      .from('inscripciones')
      .select('player_id, profiles!player_id(id, username, avatar_url, posicion, posiciones, habilidad)')
      .eq('partido_id', partido_id)
      .eq('estado', 'confirmado'),
    admin
      .from('invitados')
      .select('id, nombre')
      .eq('partido_id', partido_id)
      .eq('estado', 'confirmado'),
    admin
      .from('player_knowledge')
      .select('username, skill_override, roles, traits, notes')
      .eq('club_id', clubId),
    admin
      .from('balancer_feedback')
      .select('feedback, created_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: true }),
  ])

  const jugadores: JugadorEquipo[] = (insRes.data ?? [])
    .map(i => (i as unknown as { profiles: JugadorEquipo }).profiles)
    .filter(Boolean)

  for (const inv of invsRes.data ?? []) {
    jugadores.push({
      id: (inv as { id: string }).id,
      username: `${(inv as { nombre: string }).nombre} *`,
      avatar_url: null,
      posicion: 'cualquiera',
      habilidad: RATING_NEUTRAL,
      isInvitado: true,
    })
  }

  return {
    jugadores,
    esMinitorneo,
    clubNombre,
    knowledge: (knowledgeRes.data ?? []) as KnowledgeRow[],
    feedback: (feedbackRes.data ?? []) as FeedbackRow[],
  }
}

function construirPrompt(ctx: Contexto): string {
  const { jugadores, esMinitorneo, clubNombre, knowledge, feedback } = ctx

  const km: Record<string, KnowledgeRow> = {}
  for (const k of knowledge) km[k.username] = k

  const playerLines = jugadores.map(j => {
    const k = km[j.username.replace(' *', '')]
    const skillLabel = k?.skill_override ?? 'unknown'
    const posList = j.posiciones?.length ? j.posiciones.join('/') : j.posicion
    const roles = k?.roles?.length ? k.roles.join(', ') : posList
    const traits = k?.traits?.length ? ` | rasgos: ${k.traits.join(', ')}` : ''
    const notes = k?.notes ? ` | notas: "${k.notes}"` : ''
    const invTag = j.isInvitado ? ' [INVITADO]' : ''
    return `• ${j.username}${invTag} — habilidad: ${j.habilidad.toFixed(1)}, skill: ${skillLabel}, roles: ${roles}${traits}${notes}`
  }).join('\n')

  const feedbackLines = feedback.length > 0
    ? feedback.map(f =>
        `[${new Date(f.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}] ${f.feedback}`
      ).join('\n')
    : 'Sin feedback previo.'

  const perTeam = Math.ceil(jugadores.length / (esMinitorneo ? 3 : 2))

  return esMinitorneo
    ? `Eres el organizador de equipos del ${clubNombre}. Divide los jugadores en tres equipos balanceados para un MINITORNEO (Blanco, Negro, Morado).

=== CONTEXTO APRENDIDO (feedback histórico del administrador) ===
${feedbackLines}

=== JUGADORES DISPONIBLES HOY (${jugadores.length} jugadores) ===
${playerLines}

=== INSTRUCCIONES ===
1. Crea tres equipos lo más equilibrados posible (~${perTeam} jugadores c/u, diferencia máxima de 1)
2. Respeta ESTRICTAMENTE el feedback histórico (relaciones, conflictos, preferencias)
3. Si hay porteros disponibles, distribuye al menos uno por equipo cuando sea posible
4. Para jugadores sin datos cualitativos, usa el valor numérico de habilidad
5. Introduce variedad natural — no siempre el mismo resultado

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown:
{"equipoA":["username1","username2"],"equipoB":["username3"],"equipoC":["username4"],"razon":"Explicación clave en máx 200 caracteres"}`
    : `Eres el organizador de equipos del ${clubNombre}. Divide los jugadores disponibles en dos equipos balanceados y competitivos.

=== CONTEXTO APRENDIDO (feedback histórico del administrador) ===
${feedbackLines}

=== JUGADORES DISPONIBLES HOY (${jugadores.length} jugadores) ===
${playerLines}

=== INSTRUCCIONES ===
1. Crea Equipo A con exactamente ${perTeam} jugadores y Equipo B con exactamente ${jugadores.length - perTeam} jugadores (diferencia máxima de 1)
2. Respeta ESTRICTAMENTE el feedback histórico (relaciones, conflictos, preferencias)
3. Si hay porteros disponibles, asigna al menos uno por equipo cuando sea posible
4. Para jugadores sin datos cualitativos, usa el valor numérico de habilidad
5. Introduce variedad natural — no siempre el mismo resultado para los mismos jugadores

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown:
{"equipoA":["username1","username2"],"equipoB":["username3","username4"],"razon":"Explicación clave en máx 200 caracteres"}`
}

/** Deterministic split — also the safety net whenever Gemini is unavailable. */
function snakeDraft(ctx: Contexto): DraftResult {
  const { jugadores, esMinitorneo } = ctx
  if (esMinitorneo) {
    const sorted = [...jugadores].sort((a, b) => b.habilidad - a.habilidad)
    const eA: JugadorEquipo[] = [], eB: JugadorEquipo[] = [], eC: JugadorEquipo[] = []
    const snakeOrder = [0, 1, 2, 2, 1, 0]
    const teams = [eA, eB, eC]
    sorted.forEach((j, i) => teams[snakeOrder[i % 6]].push(j))
    return { equipoA: eA, equipoB: eB, equipoC: eC, razon: '', source: 'fallback' }
  }
  const { equipoA, equipoB } = balancearEquipos(jugadores)
  return { equipoA, equipoB, razon: '', source: 'fallback' }
}

/**
 * Suggest teams: Gemini when configured and reachable, deterministic
 * snake-draft otherwise. Never throws — a balancer outage must not stop a match
 * from getting teams.
 */
export async function calcularEquipos(ctx: Contexto): Promise<DraftResult> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey || ctx.jugadores.length < 2) {
    return { ...snakeDraft(ctx), fallbackReason: !geminiKey ? 'GEMINI_API_KEY no configurada' : 'muy pocos jugadores' }
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: construirPrompt(ctx) }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 }, // disable thinking tokens
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    )

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text().catch(() => '')
      throw new Error(`Gemini HTTP ${geminiRes.status}: ${errBody.slice(0, 200)}`)
    }

    const geminiData = await geminiRes.json()
    // gemini-2.5-flash may return thought parts before the actual answer;
    // grab the last non-thought text part to get the JSON response
    const parts: { text?: string; thought?: boolean }[] = geminiData.candidates?.[0]?.content?.parts ?? []
    const answerPart = [...parts].reverse().find(p => !p.thought && p.text)
    const rawText: string = answerPart?.text ?? ''
    const stripped = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error(`No JSON in Gemini response: ${stripped.slice(0, 100)}`)
    const parsed = JSON.parse(jsonMatch[0])

    const byUsername = Object.fromEntries(ctx.jugadores.map(j => [j.username, j]))
    const pick = (arr: unknown): JugadorEquipo[] =>
      ((arr as string[]) ?? []).map(u => byUsername[u] ?? byUsername[u + ' *']).filter(Boolean)

    const equipoA = pick(parsed.equipoA)
    const equipoB = pick(parsed.equipoB)
    const equipoC = ctx.esMinitorneo ? pick(parsed.equipoC) : []
    const allTeams = ctx.esMinitorneo ? [equipoA, equipoB, equipoC] : [equipoA, equipoB]

    // Safety: assign anyone the model dropped to the smallest team.
    const assigned = new Set(allTeams.flat().map(j => j.id))
    for (const j of ctx.jugadores) {
      if (!assigned.has(j.id)) allTeams.sort((a, b) => a.length - b.length)[0].push(j)
    }

    const razon = (parsed.razon as string) ?? ''

    if (ctx.esMinitorneo) {
      const rebalance = () => {
        const sorted = [...allTeams].sort((a, b) => b.length - a.length)
        if (sorted[0].length - sorted[2].length > 1) {
          sorted[2].push(sorted[0].pop()!)
          return true
        }
        return false
      }
      for (let i = 0; i < 10 && rebalance(); i++) { /* iterate */ }
      return { equipoA, equipoB, equipoC, razon, source: 'gemini' }
    }

    while (equipoA.length > equipoB.length + 1) equipoB.push(equipoA.pop()!)
    while (equipoB.length > equipoA.length + 1) equipoA.push(equipoB.pop()!)
    return { equipoA, equipoB, razon, source: 'gemini' }
  } catch (err) {
    const fallbackReason = err instanceof Error ? err.message : String(err)
    console.error('[teamDraft] Gemini error, falling back to snake-draft:', fallbackReason)
    return { ...snakeDraft(ctx), fallbackReason }
  }
}

/**
 * Replace this match's teams with the given split. Guests live in `invitados`
 * rather than `equipo_jugadores`, so they're attached by equipo_id instead.
 */
export async function persistirEquipos(
  admin: Admin,
  partido_id: string,
  clubId: string,
  teams: { equipoA: { id: string }[]; equipoB: { id: string }[]; equipoC?: { id: string }[] }
): Promise<{ ok: boolean; error?: string; totales: number[] }> {
  const esMinitorneo = !!teams.equipoC

  const { data: invitadosIds } = await admin
    .from('invitados').select('id').eq('partido_id', partido_id)
  const invSet = new Set((invitadosIds ?? []).map((i: { id: string }) => i.id))

  // FK on delete set null clears invitados.equipo_id automatically.
  await admin.from('equipos').delete().eq('partido_id', partido_id).eq('club_id', clubId)

  const { data: tA } = await admin.from('equipos').insert({ club_id: clubId, partido_id, nombre: 'A', color: 'blanco' }).select().single()
  const { data: tB } = await admin.from('equipos').insert({ club_id: clubId, partido_id, nombre: 'B', color: 'negro' }).select().single()
  const tC = esMinitorneo
    ? (await admin.from('equipos').insert({ club_id: clubId, partido_id, nombre: 'C', color: 'morado' }).select().single()).data
    : null

  if (!tA || !tB || (esMinitorneo && !tC)) return { ok: false, error: 'Error creando equipos', totales: [] }

  const makeRows = (list: { id: string }[], equipo_id: string) =>
    list.filter(p => !invSet.has(p.id)).map(p => ({ club_id: clubId, equipo_id, player_id: p.id }))

  const rowsA = makeRows(teams.equipoA ?? [], tA.id)
  const rowsB = makeRows(teams.equipoB ?? [], tB.id)
  const rowsC = esMinitorneo && tC ? makeRows(teams.equipoC ?? [], tC.id) : []

  if (rowsA.length) await admin.from('equipo_jugadores').insert(rowsA)
  if (rowsB.length) await admin.from('equipo_jugadores').insert(rowsB)
  if (rowsC.length) await admin.from('equipo_jugadores').insert(rowsC)

  const invA = (teams.equipoA ?? []).filter(p => invSet.has(p.id))
  const invB = (teams.equipoB ?? []).filter(p => invSet.has(p.id))
  const invC = esMinitorneo ? (teams.equipoC ?? []).filter(p => invSet.has(p.id)) : []
  await Promise.all([
    ...invA.map(p => admin.from('invitados').update({ equipo_id: tA.id }).eq('id', p.id)),
    ...invB.map(p => admin.from('invitados').update({ equipo_id: tB.id }).eq('id', p.id)),
    ...(tC ? invC.map(p => admin.from('invitados').update({ equipo_id: tC.id }).eq('id', p.id)) : []),
  ])

  return { ok: true, totales: esMinitorneo ? [rowsA.length, rowsB.length, rowsC.length] : [rowsA.length, rowsB.length] }
}

/**
 * Build and save the draft for a match in one step — what the cron calls at the
 * club's promo hour. Teams are left UNCONFIRMED: an admin still reviews them.
 */
export async function generarBorradorAuto(
  admin: Admin,
  partido_id: string,
  clubId: string
): Promise<{ ok: boolean; jugadores: number; source?: string; error?: string }> {
  const ctx = await cargarContexto(admin, partido_id, clubId)
  if (ctx.jugadores.length < 2) return { ok: false, jugadores: ctx.jugadores.length, error: 'muy pocos jugadores' }

  const draft = await calcularEquipos(ctx)
  const saved = await persistirEquipos(admin, partido_id, clubId, draft)
  if (!saved.ok) return { ok: false, jugadores: ctx.jugadores.length, error: saved.error }

  return { ok: true, jugadores: ctx.jugadores.length, source: draft.source }
}

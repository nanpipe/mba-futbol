// Falso Supabase (PostgREST + auth) para renderizar la app real sin base.
// Sirve al navegador y a las rutas de API del dev server (service key falsa).
import http from 'node:http'

const CLUB = 'a0000000-0000-0000-0000-000000000001'
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ME = uid(1)
let scenario = 'abierto'
let tema = null

const nombres = ['pipes22','alexis16','guerrero44','juli9','jbravo30','marin5','magic80','hernan14','danielb3','melo8','jsanchez17','jj21','mendieta7','ortiz97','aizaga11','camilo10','pipesolarte','ramirez23']
const roles = { 'pipes22':'superadmin', 'juli9':'admin', 'jbravo30':'admin' }
const hab = [3.42,3.18,2.96,3.61,3.05,2.88,3.27,3.12,2.74,3.33,3.0,2.91,3.08,2.82,2.69,3.5,3.0,3.15]
const profiles = nombres.map((u, i) => ({
  id: uid(i + 1), club_id: CLUB, username: u, email: `${u}@ejemplo.co`,
  role: roles[u] ?? 'player', baneado: false, aprobado: i !== 17, uniform: i % 3 !== 0,
  fecha_liberacion: null, razon_ban: null, ip_registro: '1.1.1.1', created_at: `2026-0${(i % 8) + 1}-10T12:00:00Z`,
  avatar_url: null, habilidad: hab[i], posicion: i === 5 ? 'portero' : ['defensa','medio','delantero'][i % 3],
  posiciones: [['defensa','medio','delantero'][i % 3]], ausente_desde: i === 12 ? '2026-10-25' : null, ausente_hasta: i === 12 ? '2026-11-20' : null,
}))
const P = u => profiles.find(p => p.username === u)
const mini = p => ({ id: p.id, username: p.username, avatar_url: p.avatar_url, posicion: p.posicion, posiciones: p.posiciones, habilidad: p.habilidad })

const PROX = uid(900), ULT = uid(901), ANT = uid(902), VIE = uid(903)
let FOTO = ''
function partidos() {
  return [
    { id: ANT, club_id: CLUB, fecha: '2026-10-20', dia_semana: 'martes', hora: '19:00:00', hora_apertura: '10:00:00', dias_antes_apertura: 2, cupos_total: 14, tipo: 'normal', lugar: 'Cancha La 70', evaluaciones_abiertas: false, evaluaciones_ya_abiertas: true, equipos_confirmados: true, resultado: 'negro', goles_a: 3, goles_b: 5, puntos_blanco: null, puntos_negro: null, puntos_morado: null, foto_url: null, jugado: true, notif_apertura_sent: true, inscripciones: [], invitados: [] },
    { id: ULT, club_id: CLUB, fecha: '2026-10-27', dia_semana: 'martes', hora: '19:00:00', hora_apertura: '10:00:00', dias_antes_apertura: 2, cupos_total: 14, tipo: 'normal', lugar: 'Cancha La 70', evaluaciones_abiertas: scenario === 'votacion', evaluaciones_ya_abiertas: true, equipos_confirmados: true, resultado: 'blanco', goles_a: 6, goles_b: 4, puntos_blanco: null, puntos_negro: null, puntos_morado: null, foto_url: FOTO, jugado: true, notif_apertura_sent: true, inscripciones: [], invitados: [] },
    { id: PROX, club_id: CLUB, fecha: '2026-11-03', dia_semana: 'martes', hora: '19:00:00', hora_apertura: '10:00:00', dias_antes_apertura: 2, cupos_total: 14, tipo: 'normal', lugar: 'Cancha La 70', evaluaciones_abiertas: false, evaluaciones_ya_abiertas: false, equipos_confirmados: false, resultado: null, goles_a: null, goles_b: null, puntos_blanco: null, puntos_negro: null, puntos_morado: null, foto_url: null, jugado: scenario === 'cierre' ? true : null, notif_apertura_sent: true, notif_apertura_at: null, notif_recordatorio_at: null, inscripciones: Array.from({ length: 12 }, () => ({ estado: 'confirmado' })).concat([{ estado: 'espera' }]), invitados: [{ estado: 'confirmado' }] },
    { id: VIE, club_id: CLUB, fecha: '2026-11-10', dia_semana: 'martes', hora: '19:00:00', hora_apertura: '10:00:00', dias_antes_apertura: 2, cupos_total: 14, tipo: 'normal', lugar: 'Cancha La 70', evaluaciones_abiertas: false, evaluaciones_ya_abiertas: false, equipos_confirmados: false, resultado: null, goles_a: null, goles_b: null, puntos_blanco: null, puntos_negro: null, puntos_morado: null, foto_url: null, jugado: null, notif_apertura_sent: false, inscripciones: [], invitados: [] },
  ]
}
const pRef = id => { const p = partidos().find(x => x.id === id); return { fecha: p.fecha, jugado: p.jugado, partido_id: p.id } }

let insId = 0
function inscripciones() {
  const rows = []
  const add = (pid, u, estado, pos = null) => {
    const p = P(u)
    rows.push({ id: uid(5000 + ++insId), club_id: CLUB, partido_id: pid, player_id: p.id, estado, posicion_espera: pos, created_at: '2026-11-01T15:00:00Z', profiles: mini(p), partidos: pRef(pid) })
  }
  insId = 0
  nombres.slice(0, 12).forEach(u => add(PROX, u, 'confirmado'))
  add(PROX, 'ramirez23', 'espera', 1)
  nombres.slice(0, 14).forEach(u => add(ULT, u, 'confirmado'))
  nombres.slice(1, 15).forEach(u => add(ANT, u, 'confirmado'))
  return rows
}
const invitados = () => [
  { id: uid(7001), club_id: CLUB, partido_id: PROX, player_id: P('marin5').id, nombre: 'Andrés (primo)', estado: 'confirmado', posicion_espera: null, equipo_id: null, profiles: { username: 'marin5' }, partidos: pRef(PROX) },
  { id: uid(7002), club_id: CLUB, partido_id: PROX, player_id: P('magic80').id, nombre: 'Felipe', estado: 'espera', posicion_espera: 2, equipo_id: null, profiles: { username: 'magic80' }, partidos: pRef(PROX) },
]
const EQB = uid(8001), EQN = uid(8002)
const equipos = () => [
  { id: EQB, club_id: CLUB, partido_id: ULT, nombre: 'A', color: 'blanco', confirmado: true, portero_fijo: false, portero_fijo_id: null, rotacion_banca: null, rotacion_portero: null },
  { id: EQN, club_id: CLUB, partido_id: ULT, nombre: 'B', color: 'negro', confirmado: true, portero_fijo: true, portero_fijo_id: 'marin5', rotacion_banca: null, rotacion_portero: null },
]
const equipo_jugadores = () => nombres.slice(0, 14).map((u, i) => {
  const e = i % 2 ? EQN : EQB
  return { equipo_id: e, player_id: P(u).id, profiles: mini(P(u)), equipos: { partido_id: ULT, color: i % 2 ? 'negro' : 'blanco' } }
})
const badge = (u, id, emoji, nombre, votos, pid = ULT) => ({ id: uid(9000 + Math.floor(Math.random() * 999)), club_id: CLUB, partido_id: pid, badge_id: id, badge_emoji: emoji, badge_nombre: nombre, votos, player_id: P(u).id, profiles: { username: u, avatar_url: null } })
const player_badges = () => [
  badge('juli9', 'mvp', '🏆', 'MVP del Partido', 6), badge('alexis16', 'goleador', '⚽', 'Goleador', 5),
  badge('guerrero44', 'defensa', '🛡️', 'Mejor Defensa', 4), badge('marin5', 'portero', '🧤', 'Mejor Portero', 7),
  badge('hernan14', 'desaparecido', '💤', 'Desaparecido', 3), badge('danielb3', 'desaparecido', '💤', 'Desaparecido', 3),
  badge('aizaga11', 'aizaga', '🥅', 'Aizaga del Partido', 4, ANT), badge('jj21', 'mvp', '🏆', 'MVP del Partido', 5, ANT),
]
function rating_events() {
  const rows = []
  nombres.slice(0, 14).forEach((u, i) => {
    const gano = i % 2 === 0
    const mot = ['jugó', gano ? 'ganó' : 'perdió']
    if (u === 'juli9') mot.push('reconocimiento+ ×1')
    if (u === 'hernan14') mot.push('reconocimiento− ×1')
    if (i % 4 === 1) mot.push('pulgares +1')
    let d = (gano ? 0.02 : -0.02) + (u === 'juli9' ? 0.02 : 0) + (u === 'hernan14' ? -0.02 : 0) + (i % 4 === 1 ? 0.02 : 0)
    rows.push({ id: uid(6000 + i), club_id: CLUB, partido_id: ULT, player_id: P(u).id, delta: d.toFixed(3), motivos: mot, created_at: '2026-10-28T05:00:00Z', profiles: { username: u }, partidos: pRef(ULT) })
  })
  nombres.slice(1, 15).forEach((u, i) => rows.push({ id: uid(6100 + i), club_id: CLUB, partido_id: ANT, player_id: P(u).id, delta: (i % 2 ? 0.02 : -0.02).toFixed(3), motivos: ['jugó', i % 2 ? 'ganó' : 'perdió'], created_at: '2026-10-21T05:00:00Z', profiles: { username: u }, partidos: pRef(ANT) }))
  rows.push({ id: uid(6200), club_id: CLUB, partido_id: ULT, player_id: P('camilo10').id, delta: '-0.020', motivos: ['inactivo'], created_at: '2026-10-28T05:00:00Z', profiles: { username: 'camilo10' }, partidos: pRef(ULT) })
  return rows
}
const activity_log = () => Array.from({ length: 12 }, (_, i) => ({ id: uid(4000 + i), club_id: CLUB, user_id: profiles[i % 5].id, username: profiles[i % 5].username, accion: ['inscripcion','cancelar_inscripcion','guardar_setting','login','voto'][i % 5], detalles: { partido: '2026-11-03' }, ip: '1.1.1.1', created_at: `2026-11-01T1${i % 10}:0${i % 6}:00Z` }))
const push_subscriptions = () => profiles.slice(0, 10).map(p => ({ id: p.id, player_id: p.id, club_id: CLUB, endpoint: 'x' }))
const clubs = () => [{ id: CLUB, nombre: 'MBA FC', slug: 'mbafc', timezone: 'America/Bogota', plan: 'free', subscription_status: 'active', ciudad: 'Bogotá', logo_url: null, color_primary: '#22c55e', dias_juego: ['martes'], hora_default: '19:00', hora_apertura_default: '10:00', dias_antes_apertura_default: 2 }]

const TABLES = { profiles: () => profiles, partidos, inscripciones, invitados, equipos, equipo_jugadores, player_badges, rating_events, activity_log, push_subscriptions, clubs, app_settings: () => (tema ? [{ club_id: CLUB, key: 'tema', value: tema, updated_at: '2026-11-01T00:00:00Z' }] : []), votos_reconocimiento: () => [], player_thumbs: () => [], badges_revocados: () => [], alineacion_votos: () => [], invitados_guardados: () => [], player_knowledge: () => [], balancer_feedback: () => [] }

function parseVal(v) {
  if (v === 'null') return null; if (v === 'true') return true; if (v === 'false') return false
  return v.replace(/^"|"$/g, '')
}
function test(val, op, raw) {
  const cmp = (a, b) => (typeof a === 'number' ? a - Number(b) : String(a).localeCompare(String(b)))
  switch (op) {
    case 'eq': return String(val) === String(parseVal(raw)) || val === parseVal(raw)
    case 'neq': return String(val) !== String(parseVal(raw))
    case 'gte': return val != null && cmp(val, raw) >= 0
    case 'gt': return val != null && cmp(val, raw) > 0
    case 'lte': return val != null && cmp(val, raw) <= 0
    case 'lt': return val != null && cmp(val, raw) < 0
    case 'is': return raw === 'null' ? val == null : val === parseVal(raw)
    case 'in': { const list = raw.replace(/^\(|\)$/g, '').split(',').map(parseVal); return list.map(String).includes(String(val)) }
    case 'cs': { const want = JSON.parse(raw.replace(/^\{/, '[').replace(/\}$/, ']')); return Array.isArray(val) && want.every(w => val.includes(w)) }
    default: return true
  }
}
function applyFilters(rows, params) {
  let out = rows.map(r => ({ ...r }))
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'or', 'and', 'columns', 'on_conflict'].includes(k)) continue
    const m = v.match(/^(not\.)?(\w+)\.(.*)$/s); if (!m) continue
    const [, neg, op, raw] = m
    if (k.includes('.')) {
      const [rel, col] = k.split('.')
      out = out.filter(r => {
        const n = r[rel]
        if (n == null) return true
        if (Array.isArray(n)) { r[rel] = n.filter(c => !(col in c) || (test(c[col], op, raw) !== !!neg)); return r[rel].length > 0 }
        if (!(col in n)) return true
        return test(n[col], op, raw) !== !!neg
      })
      continue
    }
    out = out.filter(r => !(k in r) || (test(r[k], op, raw) !== !!neg))
  }
  // aliases in select: alias:rel(...)
  const sel = params.get('select') || ''
  for (const m of sel.matchAll(/(\w+):(\w+)(?:!\w+)?\(/g)) out.forEach(r => { if (r[m[2]] !== undefined) r[m[1]] = r[m[2]] })
  const order = params.get('order')
  if (order) {
    const [col, dir] = order.split(',')[0].split('.')
    if (!col.includes('(')) out.sort((a, b) => { const x = a[col], y = b[col]; if (x == y) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1) })
  }
  const off = Number(params.get('offset') || 0)
  const lim = params.get('limit') ? Number(params.get('limit')) : undefined
  return out.slice(off, lim !== undefined ? off + lim : undefined)
}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
export const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, exp: 4102444800, role: 'authenticated', aud: 'authenticated', email: 'pipes22@ejemplo.co' })}.sig`
const USER = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'pipes22@ejemplo.co', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6e8f"/><stop offset=".55" stop-color="#9cc3d5"/><stop offset=".56" stop-color="#2f7d32"/><stop offset="1" stop-color="#1b4d1e"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/>${Array.from({ length: 14 }, (_, i) => `<g transform="translate(${90 + i * 82},${380 + (i % 2) * 40})"><circle r="26" cy="-60" fill="#e0b48a"/><rect x="-30" y="-30" width="60" height="110" rx="12" fill="${i % 2 ? '#111' : '#f5f5f5'}"/></g>`).join('')}</svg>`

FOTO = 'data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64')
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const send = (code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Content-Range', ...headers }); res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)) }
  if (req.method === 'OPTIONS') return send(204)
  // GET /__tema/<json urlencoded> pone un tema guardado; /__tema/null lo quita.
  if (url.pathname.startsWith('/__tema/')) { tema = JSON.parse(decodeURIComponent(url.pathname.slice(8))); return send(200, { tema }) }
  if (url.pathname.startsWith('/__scenario/')) { scenario = url.pathname.split('/')[2]; return send(200, { scenario }) }
  if (url.pathname === '/foto.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*' }); return res.end(SVG) }
  if (url.pathname.startsWith('/auth/v1/user')) return send(200, USER)
  if (url.pathname.startsWith('/auth/v1/token')) return send(200, { access_token: JWT, refresh_token: 'r', expires_in: 3600 * 24 * 365, expires_at: 4102444800, token_type: 'bearer', user: USER })
  if (url.pathname.startsWith('/auth/v1/')) return send(200, {})
  const m = url.pathname.match(/^\/rest\/v1\/(\w+)/)
  if (!m) return send(404, { message: 'no' })
  if (req.method !== 'GET' && req.method !== 'HEAD') { let b = ''; req.on('data', c => (b += c)); req.on('end', () => send(201, [])); return }
  const gen = TABLES[m[1]]
  const rows = gen ? applyFilters(gen(), url.searchParams) : []
  const accept = req.headers['accept'] || ''
  const headers = { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }
  if (req.method === 'HEAD') return send(200, undefined, headers)
  if (accept.includes('vnd.pgrst.object')) {
    if (rows.length !== 1) return send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${rows.length} rows`, hint: null })
    return send(200, rows[0], headers)
  }
  send(200, rows, headers)
}).listen(54321, () => console.log('mock supabase on 54321'))

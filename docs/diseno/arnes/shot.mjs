// node shot.mjs <ruta> <archivo.png> [scenario] [accionesJS]
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../../package.json', import.meta.url))
const { chromium } = require('playwright')
const [, , ruta, out, scenario = 'abierto', acciones = ''] = process.argv
// Carpeta de salida: OUT=/ruta/ node shot.mjs ... (por defecto /tmp/capturas/).
const OUT = (process.env.OUT ?? '/tmp/capturas/').replace(/\/?$/, '/')
await import('node:fs').then(fs => fs.mkdirSync(OUT, { recursive: true }))
await fetch(`http://localhost:54321/__scenario/${scenario}`)
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const ME = '00000000-0000-4000-8000-000000000001'
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, exp: 4102444800, role: 'authenticated', aud: 'authenticated' })}.sig`
const session = { access_token: JWT, refresh_token: 'r', expires_in: 31536000, expires_at: 4102444800, token_type: 'bearer', user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'pipes22@ejemplo.co', app_metadata: {}, user_metadata: {} } }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-CO', timezoneId: 'America/Bogota' })
await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + b64(session), domain: 'localhost', path: '/' }])
await ctx.addInitScript(() => { Object.defineProperty(window.navigator, 'standalone', { get: () => true }) })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push(String(e)))
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)) })
await p.goto('http://localhost:3111' + ruta, { waitUntil: 'networkidle', timeout: 90000 })
await p.waitForTimeout(1500)
if (acciones) { await eval(`(async () => { ${acciones} })()`); await p.waitForTimeout(1500) }
await p.screenshot({ path: OUT + out, fullPage: true })
const H = await p.evaluate(() => document.documentElement.scrollHeight)
const SEG = Number(process.env.SEG || 3)
for (let k = 0; k < SEG && k * 844 < H; k++) await p.screenshot({ path: OUT + out.replace('.png', `-${k + 1}.png`), fullPage: true, clip: { x: 0, y: k * 844, width: 390, height: Math.min(844, H - k * 844) } })
const m = await p.evaluate(() => {
  const small = [...document.querySelectorAll('button, a, [role=button], input, select, summary')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) })
  return { scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, tappables: document.querySelectorAll('button, a, [role=button], input, select, summary').length, chicos: small.length, ejemplos: small.slice(0, 8).map(e => `${e.tagName}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}:${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}`) }
})
console.log(out, JSON.stringify(m))
console.log('errores:', errs.length ? errs.slice(0, 6) : 'ninguno')
await b.close()

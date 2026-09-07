#!/usr/bin/env node
/**
 * Blocks commits that carry a credential.
 *
 * .gitignore already keeps .env files out. It cannot help when a live secret is
 * pasted into a file that is *supposed* to be committed — which is exactly how
 * the CRON_SECRET ended up in two migrations. This checks content, not paths.
 *
 * Runs over staged content. Bypass with --no-verify only when you are certain.
 */
import { execSync } from 'child_process'

const PATRONES = [
  { nombre: 'JWT (Supabase service_role / anon)', re: /eyJhbGciOi[A-Za-z0-9_\-.]{20,}/ },
  { nombre: 'Resend API key',                     re: /\bre_[A-Za-z0-9]{16,}/ },
  { nombre: 'Google / Gemini API key',            re: /\bAIza[A-Za-z0-9_\-]{30,}/ },
  { nombre: 'AWS access key id',                  re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nombre: 'Bearer token literal',               re: /Bearer\s+[A-Za-z0-9%_\-]{20,}/ },
  { nombre: 'clave privada',                      re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: 'asignación de secreto con valor',    re: /\b(SERVICE_ROLE_KEY|CRON_SECRET|INTERNAL_API_SECRET|APP_SECRET|API_KEY|PASSWORD)\s*[:=]\s*['"]?[A-Za-z0-9%_\-]{12,}/ },
]

// Placeholders are the point of .env.example and of documented SQL.
const PERMITIDO = /(<[^>]*>|TU_|YOUR_|xxx|XXX|placeholder|REEMPLAZA|ejemplo\.com|example\.com)/i

const archivos = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean)
  .filter(f => !f.startsWith('.env.example'))

let hallazgos = 0
for (const archivo of archivos) {
  let contenido = ''
  try { contenido = execSync(`git show :"${archivo}"`, { encoding: 'utf8', maxBuffer: 20e6 }) } catch { continue }
  if (contenido.includes('\u0000')) continue // binario

  contenido.split('\n').forEach((linea, i) => {
    if (PERMITIDO.test(linea)) return
    for (const { nombre, re } of PATRONES) {
      if (re.test(linea)) {
        console.error(`  ${archivo}:${i + 1} — posible ${nombre}`)
        hallazgos++
        break
      }
    }
  })
}

if (hallazgos) {
  console.error(`\n✖ ${hallazgos} posible(s) secreto(s) en lo que vas a commitear.`)
  console.error('  Si es un placeholder, escríbelo como <TU_VALOR>.')
  console.error('  Si de verdad va ahí, commitea con --no-verify (y piénsalo dos veces).\n')
  process.exit(1)
}

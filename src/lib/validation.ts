// ─── Safe error responses ────────────────────────────────────────────────────
// Never expose raw DB/library errors to clients.
const SAFE_MESSAGES: Record<string, string> = {
  'duplicate key value violates unique constraint': 'Ya existe un registro con esos datos.',
  'violates foreign key constraint': 'Referencia inválida.',
  'value too long for type': 'Uno de los campos es demasiado largo.',
  'invalid input syntax for type uuid': 'ID inválido.',
}

export function safeError(err: unknown, fallback = 'Error interno. Intenta de nuevo.'): string {
  if (typeof err === 'string') {
    for (const [pattern, msg] of Object.entries(SAFE_MESSAGES)) {
      if (err.includes(pattern)) return msg
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: string }).message
    for (const [pattern, safe] of Object.entries(SAFE_MESSAGES)) {
      if (msg.includes(pattern)) return safe
    }
  }
  return fallback
}

// ─── UUID validation ─────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUUID(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val)
}

// ─── String validation ───────────────────────────────────────────────────────
export function isString(val: unknown, min = 1, max = 255): val is string {
  return typeof val === 'string' && val.trim().length >= min && val.trim().length <= max
}

// ─── Email validation ─────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmail(val: unknown): val is string {
  return typeof val === 'string' && EMAIL_RE.test(val) && val.length <= 254
}

// ─── Date validation (YYYY-MM-DD) ─────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(val + 'T12:00:00')
  return !isNaN(d.getTime())
}

// ─── Integer in range ─────────────────────────────────────────────────────────
export function isIntInRange(val: unknown, min: number, max: number): boolean {
  const n = typeof val === 'string' ? parseInt(val, 10) : Number(val)
  return Number.isInteger(n) && n >= min && n <= max
}

// ─── Internal API secret check ────────────────────────────────────────────────
// Used to protect server-to-server calls (e.g. /api/notify called by other API routes)
export function verifyInternalSecret(req: Request | { headers: { get(k: string): string | null } }): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return true // dev: skip if not configured
  return req.headers.get('x-internal-secret') === secret
}

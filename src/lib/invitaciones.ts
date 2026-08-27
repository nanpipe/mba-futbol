import type { createAdminClient } from '@/lib/supabase/admin'
import { randomBytes } from 'crypto'

type Admin = ReturnType<typeof createAdminClient>

export type InvitacionTipo = 'club' | 'jugador'

export interface Invitacion {
  id: string
  codigo: string
  tipo: InvitacionTipo
  club_id: string | null
  club_nombre: string | null
  usado_por: string | null
  usado_at: string | null
  expira_at: string | null
  revocada: boolean
  created_at: string
}

// No 0/O/1/I — these get read aloud and typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 10

/** Cryptographically random, unambiguous, grouped as XXXXX-XXXXX. */
export function generarCodigo(): string {
  const bytes = randomBytes(CODE_LEN)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return `${out.slice(0, 5)}-${out.slice(5)}`
}

/** Accepts what the user typed in any shape; compares against stored form. */
export function normalizarCodigo(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length !== CODE_LEN) return ''
  return `${clean.slice(0, 5)}-${clean.slice(5)}`
}

/** A slug that's safe in a hostname, derived from the club name. */
export function slugify(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export type InvitacionInvalida =
  | 'no_existe'
  | 'ya_usada'
  | 'revocada'
  | 'expirada'

const MOTIVO_TEXTO: Record<InvitacionInvalida, string> = {
  no_existe: 'Ese código de invitación no existe.',
  ya_usada: 'Ese código ya fue usado.',
  revocada: 'Ese código fue revocado.',
  expirada: 'Ese código expiró.',
}

export function textoInvalida(motivo: InvitacionInvalida): string {
  return MOTIVO_TEXTO[motivo]
}

/**
 * Look up a code and confirm it can still be redeemed.
 * Deliberately returns the same shape whether the code is unknown or spent —
 * the caller decides how much to reveal.
 */
export async function validarCodigo(
  admin: Admin,
  codigoRaw: unknown
): Promise<{ ok: true; invitacion: Invitacion } | { ok: false; motivo: InvitacionInvalida }> {
  const codigo = normalizarCodigo(codigoRaw)
  if (!codigo) return { ok: false, motivo: 'no_existe' }

  const { data } = await admin
    .from('invitaciones')
    .select('id, codigo, tipo, club_id, club_nombre, usado_por, usado_at, expira_at, revocada, created_at')
    .eq('codigo', codigo)
    .maybeSingle()

  if (!data) return { ok: false, motivo: 'no_existe' }
  const inv = data as Invitacion

  if (inv.revocada) return { ok: false, motivo: 'revocada' }
  if (inv.usado_at || inv.usado_por) return { ok: false, motivo: 'ya_usada' }
  if (inv.expira_at && new Date(inv.expira_at) < new Date()) return { ok: false, motivo: 'expirada' }

  return { ok: true, invitacion: inv }
}

/**
 * Mark a code as spent, but only if it is still unspent — the WHERE clause is
 * what makes redemption single-use under concurrent requests. Returns false if
 * someone else claimed it first.
 */
export async function marcarUsada(
  admin: Admin,
  invitacionId: string,
  usuarioId: string,
  clubId?: string
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    usado_por: usuarioId,
    usado_at: new Date().toISOString(),
  }
  if (clubId) patch.club_id = clubId

  const { data } = await admin
    .from('invitaciones')
    .update(patch)
    .eq('id', invitacionId)
    .is('usado_at', null)
    .eq('revocada', false)
    .select('id')

  return Array.isArray(data) && data.length > 0
}

/** Free slug derived from the club name, with a numeric suffix on collision. */
export async function slugDisponible(admin: Admin, nombre: string): Promise<string> {
  const base = slugify(nombre) || 'club'
  for (let i = 0; i < 50; i++) {
    const candidato = i === 0 ? base : `${base}-${i + 1}`
    const { data } = await admin.from('clubs').select('id').eq('slug', candidato).maybeSingle()
    if (!data) return candidato
  }
  return `${base}-${Date.now().toString(36)}`
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import { posicionEmoji } from '@/lib/teamBalancer'
import { FifaCard } from '@/app/mi-carta/page'

const POSICIONES = ['portero', 'defensa', 'medio', 'delantero', 'cualquiera'] as const
type Posicion = typeof POSICIONES[number]

interface ProfileData {
  username: string
  email: string
  avatar_url: string | null
  created_at: string
  posicion: Posicion
}

interface Badge {
  badge_id: string
  badge_emoji: string
  badge_nombre: string
  partido_id: string | null
  earned_at: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 12 }}>
        {title}
      </div>
      <div className="card" style={{ padding: '20px 20px 16px' }}>
        {children}
      </div>
    </div>
  )
}

export default function PerfilPage() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [totalMatches, setTotalMatches] = useState(0)
  const [loading, setLoading] = useState(true)
  const [carta, setCarta] = useState<Record<string, unknown> | null>(null)

  // Position
  const [posicion, setPosicion] = useState<Posicion>('cualquiera')
  const [savingPos, setSavingPos] = useState(false)

  // Email
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  // Password
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [savingPass, setSavingPass] = useState(false)

  // Avatar
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const flash = (tipo: 'ok' | 'error', texto: string) => {
    setMensaje({ tipo, texto })
    setTimeout(() => setMensaje(null), 5000)
  }

  const cargarDatos = useCallback(async (u: User) => {
    const [{ data: prof }, { data: badgesData }, { count }] = await Promise.all([
      supabase
        .from('profiles')
        .select('username, email, avatar_url, created_at, posicion')
        .eq('id', u.id)
        .single(),
      supabase
        .from('player_badges')
        .select('badge_id, badge_emoji, badge_nombre, partido_id, earned_at')
        .eq('player_id', u.id)
        .order('earned_at', { ascending: false }),
      supabase
        .from('inscripciones')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', u.id)
        .eq('estado', 'confirmado'),
    ])

    if (prof) {
      setProfile(prof as ProfileData)
      setPosicion((prof.posicion ?? 'cualquiera') as Posicion)
      setNewEmail(prof.email ?? '')
    }
    setBadges((badgesData as Badge[]) ?? [])
    setTotalMatches(count ?? 0)

    // Load FIFA card (own)
    const cartaRes = await fetch('/api/carta')
    if (cartaRes.ok) {
      const cartaData = await cartaRes.json()
      setCarta(cartaData.carta ?? null)
    }

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user: u } }) => {
      if (!u) { window.location.href = '/login'; return }
      setUser(u)
      await cargarDatos(u)
    })
  }, [supabase, cargarDatos])

  const guardarPosicion = async () => {
    setSavingPos(true)
    const res = await fetch('/api/perfil', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posicion }),
    })
    const data = await res.json()
    if (res.ok) {
      flash('ok', data.mensaje)
      setProfile(p => p ? { ...p, posicion } : p)
    } else {
      flash('error', data.error)
    }
    setSavingPos(false)
  }

  const cambiarEmail = async () => {
    if (!newEmail.trim() || newEmail === profile?.email) return
    setSavingEmail(true)
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() })
    if (error) {
      flash('error', 'Error: ' + error.message)
    } else {
      setEmailSent(true)
      flash('ok', 'Revisa tu nuevo email para confirmar el cambio.')
    }
    setSavingEmail(false)
  }

  const cambiarPassword = async () => {
    if (newPass.length < 8) { flash('error', 'Mínimo 8 caracteres.'); return }
    if (newPass !== confirmPass) { flash('error', 'Las contraseñas no coinciden.'); return }
    setSavingPass(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    if (error) {
      flash('error', 'Error: ' + error.message)
    } else {
      flash('ok', 'Contraseña actualizada.')
      setNewPass('')
      setConfirmPass('')
    }
    setSavingPass(false)
  }

  const subirAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (!file.type.startsWith('image/')) { flash('error', 'Solo se permiten imágenes.'); return }
    if (file.size > 2 * 1024 * 1024) { flash('error', 'Máximo 2 MB.'); return }
    setUploadingAvatar(true)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const { error: uploadError } = await supabase.storage.from('avatars')
      .upload(`${user.id}/avatar.${ext}`, file, { upsert: true, contentType: file.type })
    if (uploadError) {
      flash('error', 'Error subiendo imagen.')
      setUploadingAvatar(false); e.target.value = ''; return
    }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${user.id}/avatar.${ext}`)
    const res = await fetch('/api/perfil', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_url: publicUrl }),
    })
    if (res.ok) {
      const busted = `${publicUrl}?t=${Date.now()}`
      setProfile(p => p ? { ...p, avatar_url: busted } : p)
      flash('ok', 'Foto actualizada.')
    } else {
      flash('error', 'Error guardando la foto.')
    }
    e.target.value = ''
    setUploadingAvatar(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>CARGANDO...</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
          <span className="display" style={{ fontSize: 20, letterSpacing: '0.1em' }}>MI PERFIL</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 40, maxWidth: 480 }}>
        {mensaje && (
          <div className="mono fade-in" style={{
            fontSize: 13, padding: '12px 16px', borderRadius: 3, marginBottom: 24,
            background: mensaje.tipo === 'ok' ? '#0f2d1a' : '#2d0a0a',
            color: mensaje.tipo === 'ok' ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${mensaje.tipo === 'ok' ? '#16a34a' : '#7f1d1d'}`
          }}>
            {mensaje.texto}
          </div>
        )}

        {/* Avatar + identity */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40, gap: 10 }}>
          <div style={{
            width: 96, height: 96, borderRadius: '50%',
            background: profile?.avatar_url ? 'transparent' : '#0f2d1a',
            border: '2px solid var(--border)', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span className="display" style={{ fontSize: 38, color: 'var(--green)', lineHeight: 1 }}>{profile?.username?.[0]?.toUpperCase() ?? '?'}</span>
            }
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, letterSpacing: '0.05em' }}>{profile?.username}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              {posicionEmoji(profile?.posicion ?? 'cualquiera')} {profile?.posicion ?? 'cualquiera'}
            </div>
          </div>

          <label style={{ cursor: uploadingAvatar ? 'not-allowed' : 'pointer' }}>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={subirAvatar} disabled={uploadingAvatar} style={{ display: 'none' }} />
            <span className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 16px', opacity: uploadingAvatar ? 0.5 : 1 }}>
              {uploadingAvatar ? 'Subiendo...' : '📷 Cambiar foto'}
            </span>
          </label>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>Máximo 2 MB · JPG, PNG, WEBP</div>
        </div>

        {/* Stats */}
        <div className="card" style={{ padding: '16px 20px', marginBottom: 28, display: 'flex', gap: 0 }}>
          <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div className="display" style={{ fontSize: 28, color: 'var(--green)' }}>{totalMatches}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>PARTIDOS</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 28, color: 'var(--amber)' }}>{badges.length}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>RECONOCIMIENTOS</div>
          </div>
        </div>

        {/* FIFA Card */}
        <div style={{ marginBottom: 28 }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 12 }}>
            MI CARTA FIFA
          </div>
          {carta?.aprobado ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <FifaCard size="md" s={{
                stat_res: carta.stat_res as number,
                stat_fis: carta.stat_fis as number,
                stat_def: carta.stat_def as number,
                stat_ata: carta.stat_ata as number,
                stat_tec: carta.stat_tec as number,
                stat_dis: carta.stat_dis as number,
                ovr: carta.ovr as number,
                tier: carta.tier as string,
                posicion_carta: carta.posicion_carta as string,
                username: profile?.username ?? '',
                avatar_url: profile?.avatar_url,
              }} />
              <Link href="/mi-carta" className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textDecoration: 'none', letterSpacing: '0.05em' }}>
                Ver detalles →
              </Link>
            </div>
          ) : carta && !carta.aprobado && !carta.rechazado ? (
            <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Carta en revisión</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>OVR estimado: <strong style={{ color: 'var(--amber)' }}>{carta.ovr as number}</strong></div>
            </div>
          ) : (
            <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🃏</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                {carta?.rechazado ? 'Carta rechazada — puedes volver a enviar' : 'Aún no tienes carta FIFA'}
              </div>
              <Link href="/mi-carta" className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 20px' }}>
                {carta?.rechazado ? 'Volver a evaluar →' : 'Crear mi carta →'}
              </Link>
            </div>
          )}
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <Section title="MIS BADGES">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {badges.map((b, i) => (
                <div key={i} title={b.badge_nombre} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 20, padding: '6px 12px',
                }}>
                  <span style={{ fontSize: 18 }}>{b.badge_emoji}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{b.badge_nombre}</span>
                </div>
              ))}
            </div>
            {profile?.created_at && (
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 14 }}>
                Miembro desde {new Date(profile.created_at).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
              </div>
            )}
          </Section>
        )}

        {/* Position */}
        <Section title="MI POSICIÓN">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 14 }}>
            {POSICIONES.map(p => (
              <button
                key={p}
                onClick={() => setPosicion(p)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '10px 4px', borderRadius: 4, cursor: 'pointer',
                  background: posicion === p ? '#0f2d1a' : 'transparent',
                  border: `1px solid ${posicion === p ? '#16a34a' : 'var(--border)'}`,
                  color: posicion === p ? 'var(--green)' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 20 }}>{posicionEmoji(p)}</span>
                <span className="mono" style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'capitalize' }}>{p}</span>
              </button>
            ))}
          </div>
          <button
            onClick={guardarPosicion}
            disabled={savingPos || posicion === profile?.posicion}
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '8px 16px' }}
          >
            {savingPos ? 'Guardando...' : 'Guardar posición'}
          </button>
        </Section>

        {/* Username — read-only */}
        <Section title="NOMBRE DE USUARIO">
          <div style={{
            padding: '10px 14px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 3,
            fontFamily: 'DM Mono, monospace', fontSize: 14, color: 'var(--text-muted)',
          }}>
            {profile?.username}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
            El nombre de usuario es permanente. Contacta al admin para cambiarlo.
          </div>
        </Section>

        {/* Email */}
        <Section title="EMAIL">
          <input type="email" value={newEmail} onChange={e => { setNewEmail(e.target.value); setEmailSent(false) }} placeholder="tu@email.com" />
          {emailSent
            ? <div className="mono" style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>✉ Revisa tu bandeja para confirmar.</div>
            : <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>Se enviará un correo de verificación al nuevo email.</div>
          }
          <button onClick={cambiarEmail} disabled={savingEmail || !newEmail.trim() || newEmail.trim() === profile?.email || emailSent} className="btn btn-ghost" style={{ marginTop: 12, fontSize: 11, padding: '8px 16px' }}>
            {savingEmail ? 'Enviando...' : 'Cambiar email'}
          </button>
        </Section>

        {/* Password */}
        <Section title="CONTRASEÑA">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Nueva contraseña (mín. 8)" autoComplete="new-password" />
            <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Confirmar contraseña" autoComplete="new-password" />
          </div>
          <button onClick={cambiarPassword} disabled={savingPass || !newPass || !confirmPass} className="btn btn-ghost" style={{ marginTop: 12, fontSize: 11, padding: '8px 16px' }}>
            {savingPass ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </Section>
      </div>
    </div>
  )
}

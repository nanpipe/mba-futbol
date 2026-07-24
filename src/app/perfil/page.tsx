'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import { posicionEmoji } from '@/lib/teamBalancer'
import { FifaCard } from '@/components/FifaCard'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useClub } from '@/hooks/useClub'

import { POSICIONES, type Posicion } from '@/lib/posiciones'

interface ProfileData {
  username: string
  email: string
  avatar_url: string | null
  created_at: string
  posicion: Posicion
  posiciones?: Posicion[]
  habilidad: number
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
      <SectionHeader title={title} />
      <Card padding="20px 20px 16px">
        {children}
      </Card>
    </div>
  )
}

export default function PerfilPage() {
  const supabase = createClient()
  const club = useClub()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [totalMatches, setTotalMatches] = useState(0)
  const [loading, setLoading] = useState(true)

  // Positions (up to 2)
  const [posiciones, setPosiciones] = useState<Posicion[]>([])
  const [savingPos, setSavingPos] = useState(false)
  const togglePos = (p: Posicion) => {
    setPosiciones(prev => {
      if (p === 'cualquiera') return ['cualquiera']
      const base = prev.filter(x => x !== 'cualquiera')
      if (base.includes(p)) return base.filter(x => x !== p)
      if (base.length >= 2) return [base[1], p] // keep newest two
      return [...base, p]
    })
  }

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
  const [avatarStatus, setAvatarStatus] = useState('')

  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const flash = (tipo: 'ok' | 'error', texto: string) => {
    setMensaje({ tipo, texto })
    setTimeout(() => setMensaje(null), 5000)
  }

  const cargarDatos = useCallback(async (u: User) => {
    const [{ data: prof }, { data: badgesData }, { count }] = await Promise.all([
      supabase
        .from('profiles')
        .select('username, email, avatar_url, created_at, posicion, posiciones, habilidad')
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
      const pos = (prof.posiciones as Posicion[] | null)
      setPosiciones(pos?.length ? pos : (prof.posicion ? [prof.posicion as Posicion] : []))
      setNewEmail(prof.email ?? '')
    }
    setBadges((badgesData as Badge[]) ?? [])
    setTotalMatches(count ?? 0)

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
      body: JSON.stringify({ posiciones }),
    })
    const data = await res.json()
    if (res.ok) {
      flash('ok', data.mensaje)
      setProfile(p => p ? { ...p, posiciones, posicion: posiciones[0] } : p)
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
    if (file.size > 20 * 1024 * 1024) { flash('error', 'Máximo 20 MB.'); return }

    setUploadingAvatar(true)
    e.target.value = ''

    try {
      // 1. Compress (useWebWorker: false avoids CDN web-worker CSP issues)
      setAvatarStatus('Comprimiendo...')
      const { default: imageCompression } = await import('browser-image-compression')
      const compressed = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 800,
        useWebWorker: false,
      })

      // 2. Attempt background removal (optional — skip on failure)
      let uploadBlob: Blob
      let bgRemoved = false
      try {
        setAvatarStatus('Removiendo fondo...')
        const { removeBackground } = await import('@imgly/background-removal')
        uploadBlob = await removeBackground(compressed)  // already PNG
        bgRemoved = true
      } catch (bgErr) {
        console.warn('BG removal failed, uploading without it:', bgErr)
        // Convert compressed blob → PNG via canvas so upload contentType matches
        uploadBlob = await new Promise<Blob>((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            canvas.getContext('2d')!.drawImage(img, 0, 0)
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob failed')), 'image/png')
          }
          img.onerror = reject
          img.src = URL.createObjectURL(compressed)
        })
      }

      // 3. Upload to Supabase Storage
      setAvatarStatus('Subiendo...')
      const { error: uploadError } = await supabase.storage.from('avatars')
        .upload(`${user.id}/avatar.png`, uploadBlob, { upsert: true, contentType: 'image/png' })

      if (uploadError) {
        flash('error', 'Error subiendo imagen.')
        return
      }

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${user.id}/avatar.png`)
      const res = await fetch('/api/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: publicUrl }),
      })
      if (res.ok) {
        const busted = `${publicUrl}?t=${Date.now()}`
        setProfile(p => p ? { ...p, avatar_url: busted } : p)
        flash('ok', bgRemoved ? 'Foto actualizada. Fondo removido automáticamente ✓' : 'Foto actualizada ✓')
      } else {
        flash('error', 'Error guardando la foto.')
      }
    } catch (err) {
      console.error('Avatar upload error:', err)
      flash('error', 'Error procesando la imagen. Intenta de nuevo.')
    } finally {
      setAvatarStatus('')
      setUploadingAvatar(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <LoadingSpinner text="CARGANDO..." />
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
          mensaje.tipo === 'error' ? (
            <div className="fade-in" style={{ marginBottom: 24 }}>
              <ErrorAlert message={mensaje.texto} />
            </div>
          ) : (
            <div className="mono fade-in" style={{
              fontSize: 13, padding: '12px 16px', borderRadius: 3, marginBottom: 24,
              background: '#0f2d1a',
              color: 'var(--green)',
              border: '1px solid #16a34a'
            }}>
              {mensaje.texto}
            </div>
          )
        )}

        {/* Avatar + identity */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40, gap: 10 }}>
          <PlayerAvatar
            url={profile?.avatar_url ?? null}
            username={profile?.username ?? ''}
            size={96}
            borderColor="var(--border)"
          />

          <div style={{ textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, letterSpacing: '0.05em' }}>{profile?.username}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              {(profile?.posiciones?.length ? profile.posiciones : [profile?.posicion ?? 'cualquiera'])
                .map(p => `${posicionEmoji(p)} ${p}`).join('  ·  ')}
            </div>
          </div>

          <label style={{ cursor: uploadingAvatar ? 'not-allowed' : 'pointer' }}>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={subirAvatar} disabled={uploadingAvatar} style={{ display: 'none' }} />
            <span className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 16px', opacity: uploadingAvatar ? 0.5 : 1 }}>
              {uploadingAvatar ? (avatarStatus || 'Procesando...') : '📷 Cambiar foto'}
            </span>
          </label>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>
            Se comprime y se remueve el fondo automáticamente ✨
          </div>
        </div>

        {/* Stats */}
        <Card padding="16px 20px" style={{ marginBottom: 28, display: 'flex', gap: 0 }}>
          <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div className="display" style={{ fontSize: 28, color: 'var(--green)' }}>{totalMatches}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>PARTIDOS</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 28, color: 'var(--amber)' }}>{badges.length}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>RECONOCIMIENTOS</div>
          </div>
        </Card>

        {/* Player card */}
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="MI CARTA" />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <FifaCard
              size="md"
              clubNombre={club?.nombre}
              username={profile?.username ?? ''}
              avatar_url={profile?.avatar_url}
              rating={profile?.habilidad ?? 3.0}
            />
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.6, maxWidth: 260 }}>
              Tu puntaje se gana en la cancha: sube si juegas y ganas, baja si faltas o pierdes.
            </div>
          </div>
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

        {/* Positions (up to 2) */}
        <Section title="MIS POSICIONES">
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>
            Elige hasta 2 posiciones.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(60px, 1fr))', gap: 6, marginBottom: 14 }}>
            {POSICIONES.map(p => {
              const sel = posiciones.includes(p)
              return (
                <button
                  key={p}
                  onClick={() => togglePos(p)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '10px 4px', borderRadius: 4, cursor: 'pointer',
                    background: sel ? '#0f2d1a' : 'transparent',
                    border: `1px solid ${sel ? '#16a34a' : 'var(--border)'}`,
                    color: sel ? 'var(--green)' : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{posicionEmoji(p)}</span>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'capitalize' }}>{p}</span>
                </button>
              )
            })}
          </div>
          <button
            onClick={guardarPosicion}
            disabled={savingPos || posiciones.length === 0 || posiciones.join(',') === (profile?.posiciones?.join(',') ?? profile?.posicion ?? '')}
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '8px 16px' }}
          >
            {savingPos ? 'Guardando...' : 'Guardar posiciones'}
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

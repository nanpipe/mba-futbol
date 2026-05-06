'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'

interface ProfileData {
  username: string
  email: string
  avatar_url: string | null
  created_at: string
  role: string
}

interface Stats {
  asistidos: number
  cancelados: number
}

function Avatar({ url, username, size = 80 }: { url: string | null; username: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: url ? 'transparent' : '#0f2d1a',
      border: '2px solid var(--border)',
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {url ? (
        <img src={url} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span className="display" style={{ fontSize: size * 0.4, color: 'var(--green)', lineHeight: 1 }}>
          {username?.[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  )
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
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  // Username
  const [newUsername, setNewUsername] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)

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
    const { data: prof } = await supabase
      .from('profiles')
      .select('username, email, avatar_url, created_at, role')
      .eq('id', u.id)
      .single()

    if (prof) {
      setProfile(prof as ProfileData)
      setNewUsername(prof.username ?? '')
      setNewEmail(prof.email ?? '')
    }

    // Stats: count confirmed past matches, count cancellations
    const hoy = new Date().toISOString().split('T')[0]
    const { count: asistidos } = await supabase
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', u.id)
      .eq('estado', 'confirmado')
      .lt('partidos.fecha', hoy)

    setStats({ asistidos: asistidos ?? 0, cancelados: 0 })
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user: u } }) => {
      if (!u) { window.location.href = '/login'; return }
      setUser(u)
      await cargarDatos(u)
    })
  }, [supabase, cargarDatos])

  const cambiarUsername = async () => {
    if (!newUsername.trim()) return
    setSavingUsername(true)
    const res = await fetch('/api/perfil', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      flash('ok', data.mensaje)
      setProfile(p => p ? { ...p, username: newUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') } : p)
    } else {
      flash('error', data.error)
    }
    setSavingUsername(false)
  }

  const cambiarEmail = async () => {
    if (!newEmail.trim() || newEmail === profile?.email) return
    setSavingEmail(true)
    // Email change goes through Supabase's own verification flow
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() })
    if (error) {
      flash('error', 'Error al cambiar email: ' + error.message)
    } else {
      setEmailSent(true)
      flash('ok', 'Revisa tu nuevo email para confirmar el cambio.')
    }
    setSavingEmail(false)
  }

  const cambiarPassword = async () => {
    if (newPass.length < 8) { flash('error', 'La contraseña debe tener mínimo 8 caracteres.'); return }
    if (newPass !== confirmPass) { flash('error', 'Las contraseñas no coinciden.'); return }
    setSavingPass(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    if (error) {
      flash('error', 'Error: ' + error.message)
    } else {
      flash('ok', 'Contraseña actualizada correctamente.')
      setNewPass('')
      setConfirmPass('')
    }
    setSavingPass(false)
  }

  const subirAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    if (!file.type.startsWith('image/')) { flash('error', 'Solo se permiten imágenes (JPG, PNG, WEBP).'); return }
    if (file.size > 2 * 1024 * 1024) { flash('error', 'La imagen debe ser menor a 2 MB.'); return }

    setUploadingAvatar(true)

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = `${user.id}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      flash('error', 'Error subiendo la imagen. Verifica que el bucket "avatars" exista en Supabase Storage.')
      setUploadingAvatar(false)
      // Reset input
      e.target.value = ''
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    // Cache-bust so the browser picks up the new image immediately
    const urlWithBust = `${publicUrl}?t=${Date.now()}`

    const res = await fetch('/api/perfil', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_url: publicUrl }),
    })

    if (res.ok) {
      setProfile(p => p ? { ...p, avatar_url: urlWithBust } : p)
      flash('ok', 'Foto de perfil actualizada.')
    } else {
      const data = await res.json()
      flash('error', data.error ?? 'Error guardando la foto.')
    }

    e.target.value = ''
    setUploadingAvatar(false)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>CARGANDO...</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← INICIO</Link>
          <span className="display" style={{ fontSize: 20, letterSpacing: '0.1em' }}>MI PERFIL</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 48, maxWidth: 480 }}>

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40, gap: 12 }}>
          <Avatar url={profile?.avatar_url ?? null} username={profile?.username ?? ''} size={96} />

          <label style={{ cursor: uploadingAvatar ? 'not-allowed' : 'pointer' }}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={subirAvatar}
              disabled={uploadingAvatar}
              style={{ display: 'none' }}
            />
            <span className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 16px', opacity: uploadingAvatar ? 0.5 : 1 }}>
              {uploadingAvatar ? 'Subiendo...' : '📷 Cambiar foto'}
            </span>
          </label>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Máximo 2 MB · JPG, PNG, WEBP
          </div>

          {/* Stats */}
          {stats && (
            <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="display" style={{ fontSize: 24, color: 'var(--green)' }}>{stats.asistidos}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>PARTIDOS</div>
              </div>
            </div>
          )}

          {profile?.created_at && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Miembro desde {new Date(profile.created_at).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Username */}
        <Section title="NOMBRE DE USUARIO">
          <input
            type="text"
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            placeholder="tu_usuario"
            onKeyDown={e => e.key === 'Enter' && cambiarUsername()}
          />
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
            Solo letras minúsculas, números y _ · Mínimo 2 caracteres
          </div>
          <button
            onClick={cambiarUsername}
            disabled={savingUsername || !newUsername.trim() || newUsername.trim() === profile?.username}
            className="btn btn-ghost"
            style={{ marginTop: 12, fontSize: 11, padding: '8px 16px' }}
          >
            {savingUsername ? 'Guardando...' : 'Actualizar usuario'}
          </button>
        </Section>

        {/* Email */}
        <Section title="EMAIL">
          <input
            type="email"
            value={newEmail}
            onChange={e => { setNewEmail(e.target.value); setEmailSent(false) }}
            placeholder="tu@email.com"
          />
          {emailSent ? (
            <div className="mono" style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>
              ✉ Revisa tu bandeja de entrada para confirmar el nuevo email.
            </div>
          ) : (
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
              Recibirás un correo de verificación. El cambio toma efecto al confirmar.
            </div>
          )}
          <button
            onClick={cambiarEmail}
            disabled={savingEmail || !newEmail.trim() || newEmail.trim() === profile?.email || emailSent}
            className="btn btn-ghost"
            style={{ marginTop: 12, fontSize: 11, padding: '8px 16px' }}
          >
            {savingEmail ? 'Enviando...' : 'Cambiar email'}
          </button>
        </Section>

        {/* Password */}
        <Section title="CONTRASEÑA">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="password"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              placeholder="Nueva contraseña (mín. 8 caracteres)"
              autoComplete="new-password"
            />
            <input
              type="password"
              value={confirmPass}
              onChange={e => setConfirmPass(e.target.value)}
              placeholder="Confirmar contraseña"
              autoComplete="new-password"
              onKeyDown={e => e.key === 'Enter' && cambiarPassword()}
            />
          </div>
          <button
            onClick={cambiarPassword}
            disabled={savingPass || !newPass || !confirmPass}
            className="btn btn-ghost"
            style={{ marginTop: 12, fontSize: 11, padding: '8px 16px' }}
          >
            {savingPass ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </Section>

      </div>
    </div>
  )
}

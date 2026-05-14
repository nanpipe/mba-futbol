'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function LoginPage() {
  const supabase = createClient()
  const [identifier, setIdentifier] = useState('')  // username or email
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const raw = identifier.trim().toLowerCase()
    const isEmail = raw.includes('@')

    // Resolve email + aprobado — by email or by username
    const query = isEmail
      ? supabase.from('profiles').select('email, aprobado').eq('email', raw).single()
      : supabase.from('profiles').select('email, aprobado').eq('username', raw).single()

    const { data: profile, error: profileError } = await query

    if (profileError || !profile) {
      setError('Usuario o contraseña incorrectos.')
      setLoading(false)
      return
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password,
    })

    if (authError) {
      setError('Usuario o contraseña incorrectos.')
      setLoading(false)
      return
    }

    if (!profile.aprobado) {
      await supabase.auth.signOut()
      setError('Tu cuenta está pendiente de aprobación por el administrador. Te avisaremos cuando esté lista.')
      setLoading(false)
      return
    }

    fetch('/api/auth/log-login', { method: 'POST' }).catch(() => {})
    window.location.href = '/'
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <div className="display" style={{ fontSize: 48, letterSpacing: '0.05em', lineHeight: 1 }}>
            MBA <span style={{ color: 'var(--green)' }}>FC</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.15em', marginTop: 8 }}>
            INICIAR SESIÓN
          </div>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
              USUARIO O EMAIL
            </label>
            <input
              type="text"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder="tu_usuario o correo@ejemplo.com"
              required
              autoComplete="username"
              inputMode="email"
            />
          </div>

          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
              CONTRASEÑA
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="mono" style={{
              fontSize: 13, color: 'var(--red)', padding: '10px 14px',
              background: '#2d0a0a', borderRadius: 3, border: '1px solid #7f1d1d'
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary" style={{ marginTop: 8, padding: '14px' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 24 }}>
          <Link href="/recuperar" style={{ color: 'var(--text-dim)', textDecoration: 'none' }}>¿Olvidaste tu contraseña o usuario?</Link>
        </p>

        <p className="mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
          ¿No tienes cuenta?{' '}
          <Link href="/registro" style={{ color: 'var(--green)', textDecoration: 'none' }}>Regístrate</Link>
        </p>
      </div>
    </div>
  )
}

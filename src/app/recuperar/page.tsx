'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function RecuperarPage() {
  const supabase = createClient()
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Look up email by username
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', username.trim().toLowerCase())
      .single()

    if (profileError || !profile) {
      setError('Usuario no encontrado.')
      setLoading(false)
      return
    }

    const redirectTo = `${window.location.origin}/actualizar-password`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo,
    })

    if (resetError) {
      setError('Error al enviar el correo. Intenta de nuevo.')
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <div className="display" style={{ fontSize: 48, letterSpacing: '0.05em', lineHeight: 1 }}>
            MBA <span style={{ color: 'var(--green)' }}>FC</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.15em', marginTop: 8 }}>
            RECUPERAR CONTRASEÑA
          </div>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              padding: '20px 24px', borderRadius: 3, marginBottom: 24,
              background: '#0f2d1a', border: '1px solid #16a34a',
              color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontSize: 13, lineHeight: 1.6
            }}>
              ✓ Te enviamos un correo con el enlace para restablecer tu contraseña.
              <br /><br />
              Revisa tu bandeja de entrada (y el spam).
            </div>
            <Link href="/login" className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
              ← Volver al inicio de sesión
            </Link>
          </div>
        ) : (
          <>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 32, lineHeight: 1.6 }}>
              Ingresa tu nombre de usuario y te enviaremos un correo para restablecer tu contraseña.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                  USUARIO
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="tu_usuario"
                  required
                  autoComplete="username"
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
                {loading ? 'Enviando...' : 'Enviar correo de recuperación'}
              </button>
            </form>

            <p className="mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 32 }}>
              <Link href="/login" style={{ color: 'var(--text-dim)', textDecoration: 'none' }}>← Volver al inicio de sesión</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

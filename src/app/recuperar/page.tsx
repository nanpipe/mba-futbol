'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { FormCenterLayout } from '@/components/FormCenterLayout'
import { FormLabel } from '@/components/FormLabel'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useClub } from '@/hooks/useClub'

type Mode = 'password' | 'usuario'

export default function RecuperarPage() {
  const supabase = createClient()
  const club = useClub()
  const nombreLines = club.nombre.split(' ')
  const [mode, setMode] = useState<Mode>('password')

  // Password recovery
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [loadingPwd, setLoadingPwd] = useState(false)
  const [sentPwd, setSentPwd] = useState(false)
  const [errorPwd, setErrorPwd] = useState('')

  // Username recovery
  const [emailForUser, setEmailForUser] = useState('')
  const [loadingUser, setLoadingUser] = useState(false)
  const [sentUser, setSentUser] = useState(false)
  const [errorUser, setErrorUser] = useState('')

  const handlePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoadingPwd(true)
    setErrorPwd('')

    const raw = usernameOrEmail.trim().toLowerCase()
    const isEmail = raw.includes('@')

    // Resolve email
    let resolvedEmail = raw
    if (!isEmail) {
      const res = await fetch('/api/auth/resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'email_de', valor: raw }),
      })
      const data = res.ok ? await res.json() : null
      if (!data?.email) {
        setErrorPwd('Usuario no encontrado.')
        setLoadingPwd(false)
        return
      }
      resolvedEmail = data.email
    }

    const redirectTo = `${window.location.origin}/api/auth/callback?next=/actualizar-password`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(resolvedEmail, { redirectTo })

    if (resetError) {
      setErrorPwd('Error al enviar el correo. Intenta de nuevo.')
      setLoadingPwd(false)
      return
    }

    setSentPwd(true)
    setLoadingPwd(false)
  }

  const handleUsernameRecovery = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoadingUser(true)
    setErrorUser('')

    const res = await fetch('/api/auth/recuperar-usuario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailForUser.trim().toLowerCase() }),
    })

    if (!res.ok) {
      setErrorUser('Error al enviar. Intenta de nuevo.')
      setLoadingUser(false)
      return
    }

    setSentUser(true)
    setLoadingUser(false)
  }

  return (
    <FormCenterLayout>
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 48, letterSpacing: '0.05em', lineHeight: 1 }}>
          {nombreLines.map((line, i) => (
            <span key={i}>
              {i === 1 ? <span style={{ color: 'var(--green)' }}>{line}</span> : line}
              {i < nombreLines.length - 1 && ' '}
            </span>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.15em', marginTop: 8 }}>
          RECUPERAR ACCESO
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 32 }}>
        {([
          { id: 'password', label: 'Contraseña' },
          { id: 'usuario',  label: 'Usuario' },
        ] as { id: Mode; label: string }[]).map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className="mono"
            style={{
              flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: mode === m.id ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: mode === m.id ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* ── Password recovery ── */}
      {mode === 'password' && (
        sentPwd ? (
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
              Ingresa tu usuario o email y te enviaremos un enlace para restablecer tu contraseña.
            </p>
            <form onSubmit={handlePasswordRecovery} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FormLabel label="Usuario o Email" />
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={e => setUsernameOrEmail(e.target.value)}
                  placeholder="tu_usuario o correo@ejemplo.com"
                  required
                  autoComplete="username"
                />
              </div>
              {errorPwd && <ErrorAlert message={errorPwd} />}
              <button type="submit" disabled={loadingPwd} className="btn btn-primary" style={{ marginTop: 8, padding: '14px' }}>
                {loadingPwd ? 'Enviando...' : 'Enviar enlace de recuperación'}
              </button>
            </form>
          </>
        )
      )}

      {/* ── Username recovery ── */}
      {mode === 'usuario' && (
        sentUser ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              padding: '20px 24px', borderRadius: 3, marginBottom: 24,
              background: '#0f2d1a', border: '1px solid #16a34a',
              color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontSize: 13, lineHeight: 1.6
            }}>
              ✓ Si ese correo está registrado, te enviamos tu usuario.
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
              Ingresa el correo con el que te registraste y te enviaremos tu nombre de usuario.
            </p>
            <form onSubmit={handleUsernameRecovery} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FormLabel label="Email" />
                <input
                  type="email"
                  value={emailForUser}
                  onChange={e => setEmailForUser(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  required
                  autoComplete="email"
                />
              </div>
              {errorUser && <ErrorAlert message={errorUser} />}
              <button type="submit" disabled={loadingUser} className="btn btn-primary" style={{ marginTop: 8, padding: '14px' }}>
                {loadingUser ? 'Enviando...' : 'Enviar mi usuario'}
              </button>
            </form>
          </>
        )
      )}

      <p className="mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 32 }}>
        <Link href="/login" style={{ color: 'var(--text-dim)', textDecoration: 'none' }}>← Volver al inicio de sesión</Link>
      </p>
    </FormCenterLayout>
  )
}

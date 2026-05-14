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
  // Bloqueo dramático
  const [bloqueado, setBloqueado] = useState<{ conflictingUsername: string | null } | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [sapeado, setSapeado] = useState(false)
  const [pagarRespuesta, setPagarRespuesta] = useState<'si' | 'no' | null>(null)

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

    // Stable device ID — persists in localStorage across sessions
    let deviceId = localStorage.getItem('mba_device_id')
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      localStorage.setItem('mba_device_id', deviceId)
    }

    // IP + device conflict check — awaited so we can block before redirecting
    const logRes = await fetch('/api/auth/log-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    })
    if (logRes.status === 429) {
      const logData = await logRes.json()
      await supabase.auth.signOut()
      setBloqueado({ conflictingUsername: logData.conflicting_username ?? null })
      setLoading(false)
      // Start countdown
      let c = 5
      setCountdown(c)
      const iv = setInterval(() => {
        c--
        if (c <= 0) {
          clearInterval(iv)
          setCountdown(0)
          setSapeado(true)
        } else {
          setCountdown(c)
        }
      }, 1000)
      return
    }

    window.location.href = '/'
  }

  return (
    <>
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

    {/* ── Modal dramático de bloqueo ── */}
    {bloqueado && pagarRespuesta !=='si' && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.96)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, zIndex: 999, flexDirection: 'column', gap: 0,
      }}>
        <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          {/* Mensaje principal */}
          <div style={{
            background: '#1a0000', border: '2px solid #7f1d1d',
            borderRadius: 6, padding: '28px 24px', marginBottom: 24,
          }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🚨🍺🍺🍺🚨</div>
            <p className="mono" style={{ color: '#f87171', fontSize: 15, fontWeight: 700, lineHeight: 1.8, margin: 0 }}>
              NO PUEDES REGISTRAR<br />
              A NADIE QUE NO SEAS TÚ MISMO.<br />
              <br />
              {bloqueado.conflictingUsername && (
                <>
                  <span style={{ color: '#fca5a5' }}>YA ESTABA LOGUEADO: </span>
                  <span style={{ color: '#fff', letterSpacing: '0.1em' }}>{bloqueado.conflictingUsername.toUpperCase()}</span>
                  <br /><br />
                </>
              )}
              👀 YA SABEMOS QUIÉN ERES<br />
              Y LO QUE QUERÍAS HACER.<br />
              <br />
              🍺🍺🍺 VAS A PAGAR CERVEZAS 🍺🍺🍺<br />
              POR ESTO.
            </p>
          </div>

          {/* Countdown */}
          {!sapeado && countdown !== null && (
            <div className="mono" style={{ fontSize: 13, color: '#fca5a5', letterSpacing: '0.1em', marginBottom: 8 }}>
              📡 Enviando notificación a los Admin en{' '}
              <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>{countdown}</span>
              {'...'}
            </div>
          )}

          {/* Post-countdown */}
          {sapeado && (
            <div style={{ animation: 'fadeIn 0.4s ease' }}>
              <div className="mono" style={{ fontSize: 14, color: '#4ade80', marginBottom: 20, lineHeight: 1.8 }}>
                PODRÍA NO DECIR NADA 🤫😶🤐<br />
                <br />
                <span style={{ color: '#fbbf24' }}>¿Quisieras pagar $5.000 a Nequi</span><br />
                <span style={{ color: '#fbbf24' }}>por nuestro silencio?</span>
              </div>

              {pagarRespuesta === null && (
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  <button
                    onClick={() => setPagarRespuesta('si')}
                    className="btn btn-primary"
                    style={{ flex: 1, maxWidth: 140, padding: '12px', fontSize: 15 }}
                  >
                    Sí 🍺
                  </button>
                  <button
                    onClick={() => setPagarRespuesta('no')}
                    className="btn btn-ghost"
                    style={{ flex: 1, maxWidth: 140, padding: '12px', fontSize: 15 }}
                  >
                    No 😤
                  </button>
                </div>
              )}

              {pagarRespuesta === 'si' && (
                <div style={{ background: '#0f2d1a', border: '1px solid #16a34a', borderRadius: 6, padding: '20px 24px' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🍺💚</div>
                  <div className="mono" style={{ fontSize: 13, color: '#4ade80', lineHeight: 1.8 }}>
                    Nequi: <strong style={{ fontSize: 18, color: '#fff' }}>318 810 9368</strong><br />
                    <br />
                    Envía tu comprobante<br />
                    por interno.<br />
                    <br />
                    <span style={{ color: '#86efac' }}>Gracias por tu aporte voluntario. 🙏</span>
                  </div>
                </div>
              )}

              {pagarRespuesta === 'no' && (
                <div style={{ background: '#1a0a00', border: '1px solid #92400e', borderRadius: 6, padding: '20px 24px' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>😤🍺</div>
                  <div className="mono" style={{ fontSize: 13, color: '#fbbf24', lineHeight: 1.8 }}>
                    Decisión anotada.<br />
                    Los admins ya fueron notificados.<br />
                    <br />
                    <span style={{ color: '#fca5a5' }}>Prepara las cervezas de todas formas.</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )}
    </>
  )
}

'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function RegistroPage() {
  const supabase = createClient()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)

  const handleRegistro = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      setLoading(false)
      return
    }
    if (password.length < 8) {
      setError('La contraseña debe tener mínimo 8 caracteres.')
      setLoading(false)
      return
    }

    const usernameClean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (usernameClean.length < 3) {
      setError('El usuario debe tener mínimo 3 caracteres (solo letras, números y _).')
      setLoading(false)
      return
    }

    // Obtener IP del cliente
    let ip = 'unknown'
    try {
      const ipRes = await fetch('/api/ip')
      const ipData = await ipRes.json()
      ip = ipData.ip
    } catch {
      // Si falla, continuar sin IP (el admin puede revisar)
    }

    // Verificar si la IP ya está registrada
    if (ip !== 'unknown') {
      const { data: ipExistente } = await supabase
        .from('profiles')
        .select('username')
        .eq('ip_registro', ip)
        .single()

      if (ipExistente) {
        setError(`Ya existe una cuenta registrada desde este dispositivo (@${ipExistente.username}). Solo se permite una cuenta por dispositivo.`)
        setLoading(false)
        return
      }
    }

    // Verificar username disponible
    const { data: usernameExistente } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', usernameClean)
      .single()

    if (usernameExistente) {
      setError('Ese nombre de usuario ya está en uso. Elige otro.')
      setLoading(false)
      return
    }

    // Crear cuenta en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    })

    if (authError || !authData.user) {
      if (authError?.message.includes('already registered')) {
        setError('Ese email ya tiene una cuenta registrada.')
      } else {
        setError(authError?.message ?? 'Error al crear la cuenta.')
      }
      setLoading(false)
      return
    }

    // Crear perfil
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        username: usernameClean,
        email: email.trim().toLowerCase(),
        ip_registro: ip,
        role: 'player',
      })

    if (profileError) {
      setError('Error creando el perfil. Intenta de nuevo.')
      setLoading(false)
      return
    }

    setExito(true)
    setLoading(false)
  }

  if (exito) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 24 }}>⚽</div>
          <h2 className="display" style={{ fontSize: 32, marginBottom: 16 }}>¡Registro exitoso!</h2>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 32 }}>
            Revisa tu email para confirmar tu cuenta,<br />luego inicia sesión.
          </p>
          <Link href="/login" className="btn btn-primary">Ir al login</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <div className="display" style={{ fontSize: 48, letterSpacing: '0.05em', lineHeight: 1 }}>
            MBA <span style={{ color: 'var(--green)' }}>FC</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.15em', marginTop: 8 }}>
            CREAR CUENTA
          </div>
        </div>

        <form onSubmit={handleRegistro} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
              USUARIO
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="tu_nombre"
              required
              autoComplete="username"
            />
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              Solo letras, números y _ · mínimo 3 caracteres
            </div>
          </div>

          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoComplete="email"
            />
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              Te avisamos aquí si entras desde lista de espera
            </div>
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
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
              CONFIRMAR CONTRASEÑA
            </label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="mono" style={{
              fontSize: 13, color: 'var(--red)', padding: '10px 14px',
              background: '#2d0a0a', borderRadius: 3, border: '1px solid #7f1d1d',
              lineHeight: 1.5
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary" style={{ marginTop: 8, padding: '14px' }}>
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p className="mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 32 }}>
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" style={{ color: 'var(--green)', textDecoration: 'none' }}>Inicia sesión</Link>
        </p>
      </div>
    </div>
  )
}

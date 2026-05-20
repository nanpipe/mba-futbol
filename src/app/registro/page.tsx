'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { FormCenterLayout } from '@/components/FormCenterLayout'
import { FormLabel } from '@/components/FormLabel'
import { ErrorAlert } from '@/components/ErrorAlert'

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

    // Server-side IP check (reads real IP + checks DB — can't be bypassed client-side)
    let ip = 'unknown'
    try {
      const checkRes = await fetch('/api/auth/check-registro', { method: 'POST' })
      const checkData = await checkRes.json()
      ip = checkData.ip ?? 'unknown'
      if (checkData.blocked) {
        setError(`Ya existe una cuenta registrada desde este dispositivo (@${checkData.existingUsername}). Solo se permite una cuenta por dispositivo.`)
        setLoading(false)
        return
      }
    } catch {
      // Si falla, continuar sin IP (el admin puede revisar)
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
      options: {
        data: {
          username: usernameClean,
          ip_registro: ip,
        }
      }
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

    // El trigger de DB crea el perfil automáticamente
    // Notify admins of new signup request (fire-and-forget)
    fetch('/api/notify/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameClean }),
    }).catch(() => {})

    setExito(true)
    setLoading(false)
  }

  if (exito) {
    return (
      <FormCenterLayout>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 24 }}>⚽</div>
          <h2 className="display" style={{ fontSize: 32, marginBottom: 16 }}>¡Registro exitoso!</h2>
          <p className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 32 }}>
            Tu solicitud fue enviada al administrador.<br />
            Recibirás acceso una vez que sea aprobada.<br />
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Revisa tu email para confirmar tu cuenta.</span>
          </p>
          <Link href="/login" className="btn btn-primary">Ir al login</Link>
        </div>
      </FormCenterLayout>
    )
  }

  return (
    <FormCenterLayout>
      <div style={{ padding: '40px 0' }}>
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
            <FormLabel label="USUARIO" />
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
            <FormLabel label="EMAIL" />
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
            <FormLabel label="CONTRASEÑA" />
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
            <FormLabel label="CONFIRMAR CONTRASEÑA" />
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </div>

          {error && <ErrorAlert message={error} />}

          <button type="submit" disabled={loading} className="btn btn-primary" style={{ marginTop: 8, padding: '14px' }}>
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p className="mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 32 }}>
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" style={{ color: 'var(--green)', textDecoration: 'none' }}>Inicia sesión</Link>
        </p>
      </div>
    </FormCenterLayout>
  )
}

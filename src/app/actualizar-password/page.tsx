'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { FormCenterLayout } from '@/components/FormCenterLayout'
import { FormLabel } from '@/components/FormLabel'
import { ErrorAlert } from '@/components/ErrorAlert'

export default function ActualizarPasswordPage() {
  const supabase = createClient()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const isRecovery = params.get('recovery') === 'true'
    const tokenHash = params.get('token_hash')
    const type = params.get('type')

    // Register listener first — catches PASSWORD_RECOVERY and SIGNED_IN (post-callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setReady(true); return }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session && isRecovery) {
        setReady(true)
      }
    })

    // PKCE token_hash flow (old direct link without callback)
    if (tokenHash && type === 'recovery') {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        .then(({ error }) => {
          if (error) setError('Enlace inválido o expirado.')
          else setReady(true)
        })
      return () => subscription.unsubscribe()
    }

    // Session already established by server-side callback — check immediately
    if (isRecovery) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) setReady(true)
      })
    }

    return () => subscription.unsubscribe()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    // Sign out and redirect to login
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <FormCenterLayout>
      <div style={{ marginBottom: 48, textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 48, letterSpacing: '0.05em', lineHeight: 1 }}>
          MBA <span style={{ color: 'var(--green)' }}>FC</span>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.15em', marginTop: 8 }}>
          NUEVA CONTRASEÑA
        </div>
      </div>

      {!ready ? (
        <div style={{ textAlign: 'center' }}>
          <div className="mono pulsing" style={{ color: 'var(--text-muted)', fontSize: 13, letterSpacing: '0.1em' }}>
            VERIFICANDO ENLACE...
          </div>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 16, lineHeight: 1.6 }}>
            Si llegaste aquí directamente, el enlace puede haber expirado.{' '}
            <a href="/recuperar" style={{ color: 'var(--green)', textDecoration: 'none' }}>Solicita uno nuevo.</a>
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FormLabel label="NUEVA CONTRASEÑA" />
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
              value={confirmar}
              onChange={e => setConfirmar(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </div>

          {error && <ErrorAlert message={error} />}

          <button type="submit" disabled={loading} className="btn btn-primary" style={{ marginTop: 8, padding: '14px' }}>
            {loading ? 'Guardando...' : 'Guardar nueva contraseña'}
          </button>
        </form>
      )}
    </FormCenterLayout>
  )
}

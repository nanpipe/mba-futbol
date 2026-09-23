'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import { posicionEmoji } from '@/lib/teamBalancer'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useClub } from '@/hooks/useClub'
import { ratingTierStyle, formatRating } from '@/lib/tier'
import { agruparBadges } from '@/lib/categorias'
import { InvitadosGuardados } from '@/components/InvitadosGuardados'
import { fechaColombia } from '@/lib/promoHora'
import { AUSENCIA_MAX_DIAS } from '@/lib/ausencia'
import { RecorteFotoModal } from '@/components/admin/RecorteFotoModal'
import { recortarAvatar } from '@/lib/imagen'

import { POSICIONES, type Posicion } from '@/lib/posiciones'

interface ProfileData {
  username: string
  email: string
  avatar_url: string | null
  created_at: string
  posicion: Posicion
  posiciones?: Posicion[]
  habilidad: number
  role?: string
  ausente_desde?: string | null
  ausente_hasta?: string | null
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
  const [avatarPorRecortar, setAvatarPorRecortar] = useState<File | null>(null)
  const [avatarStatus, setAvatarStatus] = useState('')

  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const flash = (tipo: 'ok' | 'error', texto: string) => {
    setMensaje({ tipo, texto })
    setTimeout(() => setMensaje(null), 5000)
  }

  // Ausencia — self-service only for admins/superadmins. Players get it from an
  // admin; /api/admin rejects anyone else, so hiding the section isn't the guard.
  const [ausenciaHasta, setAusenciaHasta] = useState('')
  const [savingAusencia, setSavingAusencia] = useState(false)
  const hoy = fechaColombia()
  const esAdmin = profile?.role === 'admin' || profile?.role === 'superadmin'
  const ausenteActiva = !!profile?.ausente_hasta && profile.ausente_hasta >= hoy
  const fechaLarga = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })

  const guardarAusencia = async (hasta: string) => {
    if (!user) return
    setSavingAusencia(true)
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'marcar_ausencia', player_id: user.id, hasta }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { flash('error', data.error ?? 'No se pudo guardar.'); return }
      flash('ok', data.mensaje ?? 'Listo.')
      setAusenciaHasta('')
      await cargarDatos(user)
    } finally {
      setSavingAusencia(false)
    }
  }

  const cargarDatos = useCallback(async (u: User) => {
    const [{ data: prof }, { data: badgesData }, { count }] = await Promise.all([
      supabase
        .from('profiles')
        .select('username, email, avatar_url, created_at, posicion, posiciones, habilidad, role, ausente_desde, ausente_hasta')
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

  /**
   * Elegir el archivo solo abre el recortador. Antes se subía directo y el
   * avatar se recortaba al centro por su cuenta: si la persona salía a un
   * lado de la foto, el círculo le cortaba media cara. Ahora ve la guía
   * redonda y encuadra ella.
   */
  const elegirAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''   // permite reelegir la misma tras cancelar
    if (!file || !user) return
    if (!file.type.startsWith('image/')) { flash('error', 'Solo se permiten imágenes.'); return }
    if (file.size > 20 * 1024 * 1024) { flash('error', 'Máximo 20 MB.'); return }
    setAvatarPorRecortar(file)
  }

  /**
   * Abre el recortador con la foto que YA está subida.
   *
   * Se baja con `fetch` y no pintando la <img> en el canvas: una imagen de
   * otro origen lo contamina y `toBlob` revienta. El bucket es público y
   * responde con CORS abierto. `cache: 'reload'` salta la caché del
   * navegador y del service worker, que si no devolverían la copia vieja.
   */
  const reencuadrarMiFoto = async (url: string) => {
    setUploadingAvatar(true)
    setAvatarStatus('Abriendo...')
    try {
      const r = await fetch(url, { cache: 'reload' })
      if (!r.ok) throw new Error(String(r.status))
      const blob = await r.blob()
      setAvatarPorRecortar(new File([blob], 'actual.webp', { type: blob.type || 'image/webp' }))
    } catch {
      flash('error', 'No se pudo abrir tu foto. Vuelve a subirla desde el carrete.')
    } finally {
      setUploadingAvatar(false)
      setAvatarStatus('')
    }
  }

  /** Lo que sale del recortador: ya viene cuadrado y a 256 px. */
  const subirAvatar = async (recortado: File) => {
    if (!user) return
    setAvatarPorRecortar(null)
    setUploadingAvatar(true)

    try {
      const compressed = recortado

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
        uploadBlob = compressed
      }

      // 3. Dejarlo del tamaño en que de verdad se ve.
      //
      // Hasta aquí el avatar venía a 800 px y en PNG con transparencia: ~700 KB
      // por jugador para pintarlo del tamaño de una moneda. Con 38 miembros eso
      // era la mitad del storage del plan gratis, y en la lista del panel se
      // veía: los avatares quedaban a medio cargar. Ahora sale cuadrado, a
      // 256 px y en WebP (~15 KB), conservando la transparencia del quitafondos.
      // El quitafondos devuelve PNG sin comprimir, así que hay que volver a
      // pasar por aquí aunque el recorte ya viniera en 256: si no, se sube un
      // PNG de varios cientos de KB. Si el quitafondos falló, `uploadBlob` ya
      // es lo que salió del recortador y esto no le quita casi nada.
      setAvatarStatus('Optimizando...')
      const { comprimirAvatar } = await import('@/lib/imagen')
      const avatar = await comprimirAvatar(uploadBlob)

      // 4. Upload to Supabase Storage
      //
      // Se escribe SOBRE el mismo objeto a propósito, aunque ahora el contenido
      // sea WebP y el nombre diga .png: el navegador tiene permiso de insert y
      // update sobre su propia carpeta, pero NO de delete. Subirlo como
      // `avatar.webp` dejaría el `.png` viejo ocupando espacio para siempre, y
      // con 38 miembros son ~26 MB que nadie podría borrar desde la app. Lo que
      // manda es el content-type, no la extensión; la URL lleva `?t=` para
      // romper la caché, que ya estaba resuelto abajo.
      setAvatarStatus('Subiendo...')
      const ruta = `${user.id}/avatar.png`
      const { error: uploadError } = await supabase.storage.from('avatars')
        .upload(ruta, avatar.blob, { upsert: true, contentType: avatar.tipo })

      if (uploadError) {
        flash('error', 'Error subiendo imagen.')
        return
      }

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(ruta)
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

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <label style={{ cursor: uploadingAvatar ? 'not-allowed' : 'pointer' }}>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={elegirAvatar} disabled={uploadingAvatar} style={{ display: 'none' }} />
              <span className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 16px', opacity: uploadingAvatar ? 0.5 : 1 }}>
                {uploadingAvatar ? (avatarStatus || 'Procesando...') : '📷 Cambiar foto'}
              </span>
            </label>
            {/* Reencuadrar la que ya está, sin volver a buscarla en el carrete:
                el encuadre es lo que más se falla y no tiene por qué obligar a
                subir la foto otra vez. */}
            {profile?.avatar_url && (
              <button
                onClick={() => reencuadrarMiFoto(profile.avatar_url!)}
                disabled={uploadingAvatar}
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '6px 16px', opacity: uploadingAvatar ? 0.5 : 1 }}
              >
                ✂️ Reencuadrar
              </button>
            )}
          </div>
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
          <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div className="display" style={{ fontSize: 28, color: 'var(--amber)' }}>{badges.length}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>RECONOCIMIENTOS</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 28 }}>★{formatRating(profile?.habilidad)}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
              {ratingTierStyle(profile?.habilidad ?? 3, club?.tiers).label}
            </div>
          </div>
        </Card>

        {/* Badges */}
        {badges.length > 0 && (
          <Section title="MIS BADGES">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {agruparBadges(badges).map(b => (
                <div key={b.badge_id} title={`${b.nombre} · ${b.veces} ${b.veces === 1 ? 'vez' : 'veces'}`} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 20, padding: '6px 12px',
                }}>
                  <span style={{ fontSize: 18 }}>{b.emoji}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{b.nombre}</span>
                  {b.veces > 1 && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>×{b.veces}</span>
                  )}
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

        {esAdmin && (
          <Section title="MI AUSENCIA">
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
              ¿De viaje o lesionado? Mientras estés ausente no pierdes puntaje por no inscribirte ni te llegan avisos.
              No puedes inscribirte hasta quitarla, y si juegas, el partido cuenta normal.
            </div>
            {ausenteActiva ? (
              <>
                <div className="mono" style={{ fontSize: 13, color: '#7dd3fc', marginBottom: 12 }}>
                  ✈️ Ausente hasta el {fechaLarga(profile!.ausente_hasta!)}
                </div>
                <button
                  onClick={() => guardarAusencia('')}
                  disabled={savingAusencia}
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '8px 16px' }}
                >
                  {savingAusencia ? '...' : 'Ya volví — quitar ausencia'}
                </button>
              </>
            ) : null}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: ausenteActiva ? 16 : 0 }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                  {ausenteActiva ? 'CAMBIAR FECHA DE REGRESO' : 'AUSENTE HASTA'}
                </div>
                <input
                  type="date"
                  value={ausenciaHasta}
                  min={hoy}
                  max={fechaColombia(new Date(Date.now() + AUSENCIA_MAX_DIAS * 86400000))}
                  onChange={e => setAusenciaHasta(e.target.value)}
                />
              </div>
              <button
                onClick={() => guardarAusencia(ausenciaHasta)}
                disabled={!ausenciaHasta || savingAusencia}
                className="btn btn-primary"
                style={{ padding: '10px 18px', opacity: ausenciaHasta ? 1 : 0.4 }}
              >
                {savingAusencia ? '...' : 'Guardar'}
              </button>
            </div>
          </Section>
        )}

        {/* Positions (up to 2) */}
        <Section title="MIS INVITADOS GUARDADOS">
          <InvitadosGuardados />
        </Section>

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

      {/* Guía redonda: lo que se ve dentro del círculo es exactamente lo que
          queda. Sin esto el recorte era al centro y a quien saliera a un lado
          de la foto le cortaba media cara. */}
      {avatarPorRecortar && (
        <RecorteFotoModal
          archivo={avatarPorRecortar}
          aspecto={1}
          redondo
          titulo="ENCUADRAR TU FOTO"
          ayuda="Centra tu cara dentro del círculo. Arrastra para mover y pellizca o usa la barra para acercar."
          procesar={recortarAvatar}
          onCancelar={() => setAvatarPorRecortar(null)}
          onListo={subirAvatar}
        />
      )}
    </div>
  )
}

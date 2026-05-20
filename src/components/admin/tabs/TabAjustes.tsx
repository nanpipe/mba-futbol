'use client'

import { useState, useCallback, useEffect } from 'react'
import { ToggleSwitch } from '@/components/admin/ToggleSwitch'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import { ButtonGroup } from '@/components/ButtonGroup'

const PUSH_SETTINGS = [
  { key: 'notif_apertura',     label: 'Inscripciones abiertas',  desc: 'Cuando abre la ventana de inscripción para un partido' },
  { key: 'notif_recordatorio', label: 'Recordatorio de partido', desc: 'A los confirmados, ≤10h antes del partido' },
  { key: 'notif_cupos',        label: 'Cupos disponibles',       desc: 'A no-inscritos cuando quedan cupos libres' },
  { key: 'notif_invitados',    label: 'Promoción de invitados',  desc: 'Mueve invitados de espera a confirmado el día del partido' },
] as const

const EMAIL_SETTINGS = [
  { key: 'email_apertura',     label: 'Email apertura partido',    desc: 'Correo a todos los jugadores cuando se abren inscripciones' },
  { key: 'email_recordatorio', label: 'Email recordatorio partido', desc: 'Correo a confirmados el día del partido (cron 10am)' },
] as const

const CLUB_TOGGLES = [
  { key: 'usar_uniforme',                    label: 'Gestión de uniformes',        desc: 'Prioridad por uniforme en inscripciones y badge en panel de jugadores' },
  { key: 'usar_invitados',                   label: 'Sistema de invitados',         desc: 'Jugadores pueden agregar invitados a los partidos' },
  { key: 'usuarios_pueden_cambiar_username', label: 'Jugadores editan su usuario',  desc: 'Permite cambiar el nombre de usuario desde el perfil' },
] as const

const CLUB_TEXT_FIELDS = [
  { key: 'club_nombre',     label: 'Nombre del club',   placeholder: 'MBA FC' },
  { key: 'club_ciudad',     label: 'Ciudad',             placeholder: 'Bogotá' },
  { key: 'club_dias_juego', label: 'Días de juego',      placeholder: 'Martes y Viernes' },
] as const

interface Props {
  active: boolean
}

export function TabAjustes({ active }: Props) {
  const [settings, setSettings] = useState<Record<string, boolean | string>>({
    notif_apertura: true,
    notif_recordatorio: true,
    notif_cupos: true,
    notif_invitados: true,
    usar_uniforme: true,
    usar_invitados: true,
    usuarios_pueden_cambiar_username: false,
  })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [savingText, setSavingText] = useState<string | null>(null)
  const [testEmailAddr, setTestEmailAddr] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const cargarSettings = useCallback(async () => {
    setSettingsLoading(true)
    const res = await fetch('/api/admin?accion=settings')
    if (res.ok) {
      const json = await res.json()
      setSettings(prev => ({ ...prev, ...(json.settings ?? {}) }))
    }
    setSettingsLoading(false)
  }, [])

  useEffect(() => {
    if (active) cargarSettings()
  }, [active, cargarSettings])

  const toggleSetting = async (key: string, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'guardar_setting', key, value }),
    })
  }

  const guardarTexto = async (key: string, value: string) => {
    setSavingText(key)
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'guardar_setting', key, value }),
    })
    setSavingText(null)
  }

  const enviarEmailPrueba = async () => {
    if (!testEmailAddr) return
    setTestEmailSending(true)
    setTestEmailResult(null)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'enviar_email_prueba', email: testEmailAddr }),
    })
    const data = await res.json()
    setTestEmailResult({ ok: res.ok, msg: data.mensaje ?? data.error ?? 'Error desconocido' })
    setTestEmailSending(false)
  }

  return (
    <div id="tab-ajustes" className="fade-in">
      <SectionHeader title="CONFIGURACIÓN" color="var(--text-muted)" />

      {settingsLoading ? (
        <LoadingSpinner />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>

          {/* Push notifications */}
          <Card padding="20px 24px">
            <SectionHeader title="NOTIFICACIONES PUSH" icon="🔔" color="var(--amber)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {PUSH_SETTINGS.map(({ key, label, desc }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                  </div>
                  <ToggleSwitch
                    checked={settings[key] !== false}
                    onChange={v => toggleSetting(key, v)}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Email notifications */}
          <Card padding="20px 24px">
            <SectionHeader title="NOTIFICACIONES EMAIL" icon="✉️" color="var(--amber)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {EMAIL_SETTINGS.map(({ key, label, desc }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                  </div>
                  <ToggleSwitch
                    checked={settings[key] !== false}
                    onChange={v => toggleSetting(key, v)}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Club settings */}
          <Card padding="20px 24px">
            <SectionHeader title="CONFIGURACIÓN DEL CLUB" icon="⚽" color="var(--green)" />

            {/* Text fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
              {CLUB_TEXT_FIELDS.map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>
                    {label}
                    {savingText === key && <span style={{ marginLeft: 8, color: 'var(--text-dim)' }}>guardando...</span>}
                  </label>
                  <input
                    type="text"
                    value={(settings[key] as string) ?? ''}
                    placeholder={placeholder}
                    onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.value }))}
                    onBlur={e => guardarTexto(key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)', marginBottom: 20 }} />

            {/* Toggle fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {CLUB_TOGGLES.map(({ key, label, desc }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                  </div>
                  <ToggleSwitch
                    checked={settings[key] !== false}
                    onChange={v => toggleSetting(key, v)}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Test email */}
          <Card padding="20px 24px">
            <SectionHeader title="ENVIAR EMAIL DE PRUEBA" icon="📧" color="var(--text-muted)" />
            <ButtonGroup gap={8}>
              <input
                type="email"
                placeholder="correo@ejemplo.com"
                value={testEmailAddr}
                onChange={e => { setTestEmailAddr(e.target.value); setTestEmailResult(null) }}
                style={{ flex: 1 }}
              />
              <button
                onClick={enviarEmailPrueba}
                disabled={testEmailSending || !testEmailAddr}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '10px 18px', whiteSpace: 'nowrap' }}
              >
                {testEmailSending ? 'Enviando...' : 'Enviar'}
              </button>
            </ButtonGroup>
            {testEmailResult && (
              <div className="mono" style={{
                fontSize: 12, marginTop: 10, padding: '8px 12px', borderRadius: 3,
                ...(testEmailResult.ok
                  ? { color: 'var(--green)', background: '#0f2d1a', border: '1px solid #16a34a' }
                  : { color: 'var(--red)', background: '#2d0a0a', border: '1px solid #7f1d1d' }),
              }}>
                {testEmailResult.ok ? '✓ ' : '✕ '}{testEmailResult.msg}
            </div>
            )}
          </Card>

          {/* Cron info */}
          <Card padding="16px 24px">
            <SectionHeader title="CRON SCHEDULE" icon="⏱" color="var(--text-muted)" />
            <div className="mono" style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--green)' }}>0 15 * * *</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>→ 10:00 AM Colombia (15:00 UTC)</span>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
              Corre diariamente. Envía push + email de apertura e inscripciones. Verifica recordatorio (≤10h antes), cupos y promoción de invitados.
            </div>
          </Card>

        </div>
      )}
    </div>
  )
}

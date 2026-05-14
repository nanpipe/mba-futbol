'use client'

import { useState, useCallback, useEffect } from 'react'
import { ToggleSwitch } from '@/components/admin/ToggleSwitch'

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

interface Props {
  active: boolean
}

export function TabAjustes({ active }: Props) {
  const [settings, setSettings] = useState<Record<string, boolean>>({
    notif_apertura: true,
    notif_recordatorio: true,
    notif_cupos: true,
    notif_invitados: true,
  })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [testEmailAddr, setTestEmailAddr] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const cargarSettings = useCallback(async () => {
    setSettingsLoading(true)
    const res = await fetch('/api/admin?accion=settings')
    if (res.ok) {
      const json = await res.json()
      setSettings(json.settings ?? {})
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
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 32 }}>
        CONFIGURACIÓN
      </div>

      {settingsLoading ? (
        <div className="mono pulsing" style={{ fontSize: 13, color: 'var(--text-muted)', padding: 48, textAlign: 'center' }}>Cargando...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>

          {/* Push notifications */}
          <div className="card" style={{ padding: '20px 24px' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--amber)', marginBottom: 20 }}>🔔 NOTIFICACIONES PUSH</div>
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
          </div>

          {/* Email notifications */}
          <div className="card" style={{ padding: '20px 24px' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--amber)', marginBottom: 20 }}>✉️ NOTIFICACIONES EMAIL</div>
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
          </div>

          {/* Test email */}
          <div className="card" style={{ padding: '20px 24px' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 16 }}>📧 ENVIAR EMAIL DE PRUEBA</div>
            <div style={{ display: 'flex', gap: 8 }}>
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
            </div>
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
          </div>

          {/* Cron info */}
          <div className="card" style={{ padding: '16px 24px' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 12 }}>⏱ CRON SCHEDULE</div>
            <div className="mono" style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--green)' }}>0 15 * * *</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>→ 10:00 AM Colombia (15:00 UTC)</span>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
              Corre diariamente. Envía push + email de apertura e inscripciones. Verifica recordatorio (≤10h antes), cupos y promoción de invitados.
            </div>
          </div>

        </div>
      )}
    </div>
  )
}

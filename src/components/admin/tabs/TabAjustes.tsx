'use client'

import { useState, useCallback, useEffect } from 'react'
import { ToggleSwitch } from '@/components/admin/ToggleSwitch'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { SectionHeader } from '@/components/SectionHeader'
import { ButtonGroup } from '@/components/ButtonGroup'
import { GAME_CONFIG } from '@/lib/gameConfig'
import { NOTIF_EVENTS } from '@/lib/notifications'

const CLUB_TOGGLES = [
  { key: 'usar_uniforme',                    label: 'Gestión de uniformes',        desc: 'Prioridad por uniforme en inscripciones y badge en panel de jugadores' },
  { key: 'usar_invitados',                   label: 'Sistema de invitados',         desc: 'Jugadores pueden agregar invitados a los partidos' },
  { key: 'usuarios_pueden_cambiar_username', label: 'Jugadores editan su usuario',  desc: 'Permite cambiar el nombre de usuario desde el perfil' },
] as const

const CLUB_TEXT_FIELDS = [
  { key: 'club_nombre', label: 'Nombre del club', placeholder: 'MBA FC' },
  { key: 'club_ciudad', label: 'Ciudad',           placeholder: 'Bogotá' },
] as const

// Días/horarios de partido se derivan de los partidos reales, no se configuran como texto.
const HORARIOS_FIELDS = [
  { key: 'hora_promo_invitados', label: 'Hora promoción invitados', placeholder: '2:00 PM' },
] as const

interface Props {
  active: boolean
  /** Superadmin sees + edits the game configuration section */
  isSuperAdmin?: boolean
}

export function TabAjustes({ active, isSuperAdmin = false }: Props) {
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
  const [notifPruebaSending, setNotifPruebaSending] = useState(false)
  const [notifPruebaResult, setNotifPruebaResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [cronSending, setCronSending] = useState(false)
  const [cronResult, setCronResult] = useState<{ ok: boolean; msg: string } | null>(null)

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

  // Resolve a channel toggle: stored value if present, else the event default.
  const chanOn = (key: string, def: boolean) => {
    const v = settings[key]
    if (v === true || v === false) return v
    if (v === 'true') return true
    if (v === 'false') return false
    return def
  }

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

  const enviarNotifPrueba = async () => {
    setNotifPruebaSending(true)
    setNotifPruebaResult(null)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'enviar_notif_prueba' }),
    })
    const data = await res.json()
    if (res.ok) {
      const msg = `Push: ${data.pushOk ?? 0} ok / ${data.pushFail ?? 0} fail (${data.subsTotal ?? 0} subs) · Email: ${data.emailOk ? 'ok' : data.emailError ?? 'error'}`
      setNotifPruebaResult({ ok: true, msg })
    } else {
      setNotifPruebaResult({ ok: false, msg: data.error ?? 'Error desconocido' })
    }
    setNotifPruebaSending(false)
  }

  const dispararCron = async () => {
    setCronSending(true)
    setCronResult(null)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'disparar_cron' }),
    })
    const data = await res.json()
    if (res.ok) {
      setCronResult({ ok: data.ok ?? false, msg: `Status ${data.status} · ${JSON.stringify(data.resultado ?? {})}` })
    } else {
      setCronResult({ ok: false, msg: data.error ?? 'Error desconocido' })
    }
    setCronSending(false)
  }

  return (
    <div id="tab-ajustes" className="fade-in">
      <SectionHeader title="CONFIGURACIÓN" color="var(--text-muted)" />

      {settingsLoading ? (
        <LoadingSpinner />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>

          {/* Notification channels — per-event email/push matrix */}
          <Card padding="20px 24px">
            <SectionHeader title="NOTIFICACIONES" icon="🔔" color="var(--amber)" />
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>
              Elige canal por evento. Alertas de admin (registro, inscripción, baja) se agrupan en un resumen cada ~10 min para no saturar.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }} />
                <div className="mono" style={{ width: 44, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>📧</div>
                <div className="mono" style={{ width: 44, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>🔔</div>
              </div>
              {NOTIF_EVENTS.map(ev => {
                const emailOn = chanOn(ev.emailKey, ev.emailDefault)
                const pushOn = chanOn(ev.pushKey, ev.pushDefault)
                return (
                  <div key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {ev.label}
                        {ev.batch && <span className="mono" style={{ marginLeft: 6, fontSize: 9, color: '#a78bfa' }}>resumen</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{ev.desc}</div>
                    </div>
                    <div style={{ width: 44, display: 'flex', justifyContent: 'center' }}>
                      <ToggleSwitch checked={emailOn} onChange={v => toggleSetting(ev.emailKey, v)} />
                    </div>
                    <div style={{ width: 44, display: 'flex', justifyContent: 'center' }}>
                      <ToggleSwitch checked={pushOn} onChange={v => toggleSetting(ev.pushKey, v)} />
                    </div>
                  </div>
                )
              })}
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

          {/* Horarios y días */}
          <Card padding="20px 24px">
            <SectionHeader title="INVITADOS" icon="🎟️" color="var(--amber)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {HORARIOS_FIELDS.map(({ key, label, placeholder }) => (
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
          </Card>

          {/* Configuración de juego — superadmin only */}
          {isSuperAdmin && (
            <Card padding="20px 24px">
              <SectionHeader title="CONFIGURACIÓN DE JUEGO" icon="🎮" color="#a78bfa" />
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>
                Cómo se arman y juegan los equipos de este club. Solo superadmin.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                {GAME_CONFIG.map(({ key, label, desc, def }) => (
                  <div key={key} style={{ minWidth: 0 }}>
                    <label className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>
                      {label}
                      {savingText === key && <span style={{ marginLeft: 8, color: 'var(--text-dim)' }}>guardando...</span>}
                    </label>
                    <input
                      type="text"
                      value={(settings[key] as string) ?? ''}
                      placeholder={def}
                      onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.value }))}
                      onBlur={e => guardarTexto(key, e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                    <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

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

          {/* Diagnóstico de notificaciones */}
          <Card padding="20px 24px">
            <SectionHeader title="DIAGNÓSTICO DE NOTIFICACIONES" icon="🔬" color="var(--text-muted)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <button
                  onClick={enviarNotifPrueba}
                  disabled={notifPruebaSending}
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '10px 18px', whiteSpace: 'nowrap' }}
                >
                  {notifPruebaSending ? 'Enviando...' : '🔔 Enviar notificación de prueba'}
                </button>
                {notifPruebaResult && (
                  <div className="mono" style={{
                    fontSize: 11, marginTop: 8, padding: '8px 12px', borderRadius: 3,
                    ...(notifPruebaResult.ok
                      ? { color: 'var(--green)', background: '#0f2d1a', border: '1px solid #16a34a' }
                      : { color: 'var(--red)', background: '#2d0a0a', border: '1px solid #7f1d1d' }),
                  }}>
                    {notifPruebaResult.ok ? '✓ ' : '✕ '}{notifPruebaResult.msg}
                  </div>
                )}
              </div>
              <div>
                <button
                  onClick={dispararCron}
                  disabled={cronSending}
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '10px 18px', whiteSpace: 'nowrap' }}
                >
                  {cronSending ? 'Ejecutando...' : '▶ Disparar cron manualmente'}
                </button>
                {cronResult && (
                  <div className="mono" style={{
                    fontSize: 11, marginTop: 8, padding: '8px 12px', borderRadius: 3,
                    ...(cronResult.ok
                      ? { color: 'var(--green)', background: '#0f2d1a', border: '1px solid #16a34a' }
                      : { color: 'var(--red)', background: '#2d0a0a', border: '1px solid #7f1d1d' }),
                  }}>
                    {cronResult.ok ? '✓ ' : '✕ '}{cronResult.msg}
                  </div>
                )}
              </div>
            </div>
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

import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

/** Escape user-supplied strings before interpolating into HTML email bodies. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendPromovido({
  email,
  username,
  fechaPartido,
  diaSemana,
  clubNombre = 'MBA Fútbol Club',
}: {
  email: string
  username: string
  fechaPartido: string
  diaSemana: string
  clubNombre?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
  const result = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `⚽ ¡Tienes cupo! ${clubNombre}`,
    html: `
      <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
        <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">${esc(clubNombre)}</div>
        <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
          ¡Entraste al partido, <strong>${esc(username)}</strong>!
        </h1>
        <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">
          Se liberó un cupo y pasaste de la lista de espera al partido del
          <strong style="color: #f0f0f0;">${esc(diaSemana)} ${esc(fechaPartido)}</strong> a las 7:00 pm.
        </p>
        <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
          <p style="margin: 0; font-size: 14px; color: #4ade80;">Estado: <strong>CONFIRMADO ✓</strong></p>
        </div>
        <p style="color: #666; font-size: 13px; margin: 0;">
          Si no puedes asistir, entra a la app y libera tu cupo para que otro compañero pueda jugar.
        </p>
        <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
        <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">${esc(clubNombre.toUpperCase())}</p>
      </div>
    `,
  })
  return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export async function sendAperturaEmail({
  email,
  username,
  diaSemana,
  fechaPartido,
  hora,
  clubNombre = 'MBA Fútbol Club',
}: {
  email: string
  username: string
  diaSemana: string
  fechaPartido: string
  hora: string
  clubNombre?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `⚽ ¡Inscripciones abiertas! ${clubNombre}`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">${esc(clubNombre)}</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
            ¡Hola <strong>${esc(username)}</strong>! Ya están abiertas las inscripciones.
          </h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">
            El partido del <strong style="color: #f0f0f0;">${esc(diaSemana)} ${esc(fechaPartido)}</strong> a las
            <strong style="color: #f0f0f0;">${esc(hora)}</strong> ya tiene cupos disponibles. ¡Entra y anótate antes de que se llenen!
          </p>
          <div style="background: #1a1a1a; border-left: 3px solid #facc15; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
            <p style="margin: 0; font-size: 14px; color: #facc15;">⚽ Inscripciones ABIERTAS</p>
          </div>
          <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://mba-futbol.vercel.app'}"
             style="display: inline-block; background: #facc15; color: #0a0a0a; font-weight: 700; font-size: 14px; letter-spacing: 2px; padding: 12px 28px; border-radius: 4px; text-decoration: none; text-transform: uppercase; margin-bottom: 32px;">
            Ver partido →
          </a>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">${esc(clubNombre.toUpperCase())}</p>
        </div>
      `,
    })
    return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export async function sendRecordatorioEmail({
  email,
  username,
  diaSemana,
  hora,
  clubNombre = 'MBA Fútbol Club',
}: {
  email: string
  username: string
  diaSemana: string
  hora: string
  clubNombre?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `⏰ Recordatorio de partido — ${clubNombre}`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">${esc(clubNombre)}</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
            ¡Hoy es día de partido, <strong>${esc(username)}</strong>!
          </h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">
            Hoy <strong style="color: #f0f0f0;">${esc(diaSemana)}</strong> a las
            <strong style="color: #f0f0f0;">${esc(hora)}</strong> es el partido. Estás confirmado.
          </p>
          <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
            <p style="margin: 0; font-size: 14px; color: #4ade80;">Estado: <strong>CONFIRMADO ✓</strong></p>
          </div>
          <p style="color: #aaa; font-size: 14px; line-height: 1.6; margin: 0 0 32px 0;">
            Si no puedes asistir, entra a la app y libera tu cupo para que otro compañero pueda jugar 🙏
          </p>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">${esc(clubNombre.toUpperCase())}</p>
        </div>
      `,
    })
    return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export async function sendTestEmail({
  email,
  clubNombre = 'MBA Fútbol Club',
}: {
  email: string
  clubNombre?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `✅ Email de prueba — ${clubNombre}`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">${esc(clubNombre)}</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
            Email de prueba ✅
          </h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">
            El sistema de correos está funcionando correctamente. Este es un email de prueba enviado desde el panel de administración.
          </p>
          <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
            <p style="margin: 0; font-size: 14px; color: #4ade80;">Sistema: <strong>OPERATIVO ✓</strong></p>
          </div>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">${esc(clubNombre.toUpperCase())}</p>
        </div>
      `,
    })
    return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export async function sendEquipoConfirmado({
  email,
  username,
  colorEq,
  compañeros,
  clubNombre = 'MBA Fútbol Club',
}: {
  email: string
  username: string
  colorEq: string
  compañeros: string[]
  clubNombre?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://mba-futbol.vercel.app'
  const listHtml = compañeros.length
    ? `<ul style="margin: 0; padding: 0 0 0 18px; color: #aaa; font-size: 14px; line-height: 1.8;">${compañeros.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '<p style="color:#666;font-size:13px;margin:0;">—</p>'
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `⚽ Equipo ${esc(colorEq)} confirmado — ${clubNombre}`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">${esc(clubNombre)}</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
            ¡Hola <strong>${esc(username)}</strong>! Ya están confirmados los equipos.
          </h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
            Juegas con el <strong style="color: #f0f0f0;">Equipo ${esc(colorEq)}</strong>.
          </p>
          <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 16px 20px; border-radius: 4px; margin-bottom: 24px;">
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #888; letter-spacing: 2px; text-transform: uppercase;">Tus compañeros</p>
            ${listHtml}
          </div>
          <a href="${appUrl}" style="display: inline-block; background: #facc15; color: #0a0a0a; font-weight: 700; font-size: 14px; letter-spacing: 2px; padding: 12px 28px; border-radius: 4px; text-decoration: none; text-transform: uppercase; margin-bottom: 32px;">
            Ver alineación →
          </a>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">${esc(clubNombre.toUpperCase())}</p>
        </div>
      `,
    })
    return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export async function sendAdminAlertEmail({
  email,
  titulo,
  mensaje,
  clubNombre = 'MBA Fútbol Club',
}: {
  email: string
  titulo: string
  mensaje: string
  clubNombre?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `${titulo} · ${clubNombre}`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">${esc(clubNombre)}</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">${esc(titulo)}</h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">${esc(mensaje)}</p>
          <div style="background: #1a1a1a; border-left: 3px solid #facc15; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
            <a href="https://futbol.niebla.co/admin"
               style="color: #facc15; font-size: 14px; text-decoration: none; font-weight: 700; letter-spacing: 1px;">
              Ir al panel de admin &#8594;
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">${esc(clubNombre.toUpperCase())}</p>
        </div>
      `,
    })
    return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export async function sendUsernameEmail({
  email,
  username,
  clubNombre = 'MBA Fútbol Club',
}: {
  email: string
  username: string
  clubNombre?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `\u{1F464} Tu usuario — ${clubNombre}`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">${esc(clubNombre)}</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">Tu nombre de usuario</h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">Solicitaste recuperar tu usuario. Aquí está:</p>
          <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 20px 24px; border-radius: 4px; margin-bottom: 32px;">
            <p style="margin: 0; font-size: 22px; color: #f0f0f0; font-family: 'DM Mono', monospace; letter-spacing: 0.05em;">${esc(username)}</p>
          </div>
          <p style="color: #aaa; font-size: 14px; line-height: 1.6; margin: 0 0 32px 0;">Si no solicitaste esto, puedes ignorar este correo.</p>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">${esc(clubNombre.toUpperCase())}</p>
        </div>
      `,
    })
    return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

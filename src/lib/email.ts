import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

export async function sendPromovido({
  email,
  username,
  fechaPartido,
  diaSemana,
}: {
  email: string
  username: string
  fechaPartido: string
  diaSemana: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
  const result = await resend.emails.send({
    from: FROM,
    to: email,
    subject: '⚽ ¡Tienes cupo! MBA Fútbol Club',
    html: `
      <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
        <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">MBA Fútbol Club</div>
        <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
          ¡Entraste al partido, <strong>${username}</strong>!
        </h1>
        <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">
          Se liberó un cupo y pasaste de la lista de espera al partido del 
          <strong style="color: #f0f0f0;">${diaSemana} ${fechaPartido}</strong> a las 7:00 pm.
        </p>
        <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
          <p style="margin: 0; font-size: 14px; color: #4ade80;">Estado: <strong>CONFIRMADO ✓</strong></p>
        </div>
        <p style="color: #666; font-size: 13px; margin: 0;">
          Si no puedes asistir, entra a la app y libera tu cupo para que otro compañero pueda jugar.
        </p>
        <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
        <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">MBA FÚTBOL CLUB</p>
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
}: {
  email: string
  username: string
  diaSemana: string
  fechaPartido: string
  hora: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: '⚽ ¡Inscripciones abiertas! MBA Fútbol Club',
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">MBA Fútbol Club</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
            ¡Hola <strong>${username}</strong>! Ya están abiertas las inscripciones.
          </h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">
            El partido del <strong style="color: #f0f0f0;">${diaSemana} ${fechaPartido}</strong> a las
            <strong style="color: #f0f0f0;">${hora}</strong> ya tiene cupos disponibles. ¡Entra y anótate antes de que se llenen!
          </p>
          <div style="background: #1a1a1a; border-left: 3px solid #facc15; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
            <p style="margin: 0; font-size: 14px; color: #facc15;">⚽ Inscripciones ABIERTAS</p>
          </div>
          <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://mba-futbol.vercel.app'}"
             style="display: inline-block; background: #facc15; color: #0a0a0a; font-weight: 700; font-size: 14px; letter-spacing: 2px; padding: 12px 28px; border-radius: 4px; text-decoration: none; text-transform: uppercase; margin-bottom: 32px;">
            Ver partido →
          </a>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">MBA FÚTBOL CLUB</p>
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
}: {
  email: string
  username: string
  diaSemana: string
  hora: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: '⏰ Recordatorio de partido — MBA Fútbol Club',
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">MBA Fútbol Club</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">
            ¡Hoy es día de partido, <strong>${username}</strong>!
          </h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0;">
            Hoy <strong style="color: #f0f0f0;">${diaSemana}</strong> a las
            <strong style="color: #f0f0f0;">${hora}</strong> es el partido. Estás confirmado.
          </p>
          <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 16px 20px; border-radius: 4px; margin-bottom: 32px;">
            <p style="margin: 0; font-size: 14px; color: #4ade80;">Estado: <strong>CONFIRMADO ✓</strong></p>
          </div>
          <p style="color: #aaa; font-size: 14px; line-height: 1.6; margin: 0 0 32px 0;">
            Si no puedes asistir, entra a la app y libera tu cupo para que otro compañero pueda jugar 🙏
          </p>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">MBA FÚTBOL CLUB</p>
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
}: {
  email: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: '✅ Email de prueba — MBA Fútbol Club',
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">MBA Fútbol Club</div>
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
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">MBA FÚTBOL CLUB</p>
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
}: {
  email: string
  username: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: '\u{1F464} Tu usuario — MBA Fútbol Club',
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #f0f0f0; padding: 40px 32px; border-radius: 8px;">
          <div style="font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #888; margin-bottom: 32px;">MBA Fútbol Club</div>
          <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 16px 0; line-height: 1.2;">Tu nombre de usuario</h1>
          <p style="color: #aaa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">Solicitaste recuperar tu usuario. Aquí está:</p>
          <div style="background: #1a1a1a; border-left: 3px solid #4ade80; padding: 20px 24px; border-radius: 4px; margin-bottom: 32px;">
            <p style="margin: 0; font-size: 22px; color: #f0f0f0; font-family: 'DM Mono', monospace; letter-spacing: 0.05em;">${username}</p>
          </div>
          <p style="color: #aaa; font-size: 14px; line-height: 1.6; margin: 0 0 32px 0;">Si no solicitaste esto, puedes ignorar este correo.</p>
          <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;" />
          <p style="color: #444; font-size: 12px; margin: 0; letter-spacing: 1px;">MBA FÚTBOL CLUB</p>
        </div>
      `,
    })
    return { ok: true, id: (result as { data?: { id?: string } }).data?.id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

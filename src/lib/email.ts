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
}) {
  await resend.emails.send({
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
}

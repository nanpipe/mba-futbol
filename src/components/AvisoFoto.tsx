'use client'

import Link from 'next/link'

/**
 * Empuja a quien no tiene foto de perfil a subir una, con tono creciente.
 *
 * Por qué molesta y no bloquea: impedirle inscribirse a un partido a alguien
 * por no tener foto sería un problema de verdad en el grupo —alguien se queda
 * sin jugar por un avatar— y el chiste dejaría de serlo en el primer viernes
 * que pase. Molestar funciona; bloquear cuesta un jugador.
 *
 * El aviso NO se puede cerrar, a propósito: el que lo cierra una vez no lo
 * vuelve a ver y nunca sube la foto. Desaparece solo cuando hay foto, que es
 * exactamente lo que se busca.
 */

/** A partir de cuántos partidos jugados se pone pesado. */
export const PARTIDOS_DE_GRACIA = 3

// Los del edit. Es el chiste del club; para cambiarlo, es esta línea.
const EDITORES = 'Jordan y Jojoa'

function mensaje(jugados: number): { texto: string; color: string; borde: string; fondo: string } {
  const restantes = PARTIDOS_DE_GRACIA - jugados

  if (restantes > 1) {
    return {
      texto: `Te falta la foto de perfil. Tienes ${restantes} partidos para subirla.`,
      color: 'var(--text-muted)', borde: 'var(--border)', fondo: 'var(--bg-card)',
    }
  }
  if (restantes === 1) {
    return {
      texto: `Te queda UN partido para subir tu foto. Después la escogen ${EDITORES}.`,
      color: 'var(--amber)', borde: '#92400e', fondo: '#1a1000',
    }
  }
  return {
    texto: `Se te acabó el plazo. ${EDITORES} ya pueden elegirte la foto, y no la vas a poder cambiar. Todavía estás a tiempo.`,
    color: '#f87171', borde: '#7f1d1d', fondo: '#2a0f0f',
  }
}

export function AvisoFoto({ tieneFoto, partidosJugados }: {
  tieneFoto: boolean
  partidosJugados: number
}) {
  if (tieneFoto) return null
  const m = mensaje(partidosJugados)

  return (
    <Link
      href="/perfil"
      className="mono fade-in"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', marginBottom: 20,
        background: m.fondo, border: `1px solid ${m.borde}`, borderRadius: 4,
        color: m.color, fontSize: 11, lineHeight: 1.5, textDecoration: 'none',
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }} aria-hidden="true">📸</span>
      <span style={{ flex: 1, minWidth: 0 }}>{m.texto}</span>
      <span style={{ flexShrink: 0, opacity: 0.7 }}>→</span>
    </Link>
  )
}

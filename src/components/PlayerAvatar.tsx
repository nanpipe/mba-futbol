import { inicialONumero } from '@/lib/numeroCamiseta'

interface PlayerAvatarProps {
  url: string | null
  username: string
  size?: number
  borderColor?: string
}

/**
 * Foto del jugador, o su dorsal cuando no tiene.
 *
 * El respaldo era la inicial del username, y eso no distinguía a nadie: en el
 * club hay cinco usernames que empiezan por "j". Como la convención es que el
 * dorsal va al final del username (`alexis16` → 16), se pinta ese, que además
 * es como se reconocen en la cancha. Quien no lo lleve sigue viendo su
 * inicial (ver `lib/numeroCamiseta.ts`).
 */
export function PlayerAvatar({ url, username, size = 32, borderColor }: PlayerAvatarProps) {
  const etiqueta = inicialONumero(username)
  // El dorsal de dos cifras necesita más caja que una letra, o se sale.
  const escala = etiqueta.length >= 2 ? 0.34 : 0.4

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: url ? 'transparent' : '#0f2d1a',
      border: `1px solid ${borderColor ?? 'var(--border)'}`,
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={username} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span className="display" style={{ fontSize: size * escala, color: 'var(--green)', lineHeight: 1 }}>
          {etiqueta}
        </span>
      )}
    </div>
  )
}

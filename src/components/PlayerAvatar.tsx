'use client'

import { useState, useEffect } from 'react'
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
 *
 * Si la imagen NO carga se usa el mismo respaldo. Antes quedaba un círculo
 * vacío o el icono de imagen rota del navegador, que es lo que se veía en la
 * lista de miembros con los avatares pesados a medio cargar: un hueco no dice
 * quién es, el dorsal sí.
 */
export function PlayerAvatar({ url, username, size = 32, borderColor }: PlayerAvatarProps) {
  const [fallo, setFallo] = useState(false)
  // Si cambia la foto (por ejemplo tras subir una nueva, con `?t=` distinto),
  // hay que volver a intentarlo: si no, quedaría en el respaldo para siempre.
  useEffect(() => { setFallo(false) }, [url])

  const etiqueta = inicialONumero(username)
  // El dorsal de dos cifras necesita más caja que una letra, o se sale.
  const escala = etiqueta.length >= 2 ? 0.34 : 0.4
  const muestraFoto = Boolean(url) && !fallo

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: muestraFoto ? 'transparent' : '#0f2d1a',
      border: `1px solid ${borderColor ?? 'var(--border)'}`,
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {muestraFoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url!}
          alt={username}
          loading="lazy"
          decoding="async"
          onError={() => setFallo(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span className="display" style={{ fontSize: size * escala, color: 'var(--green)', lineHeight: 1 }}>
          {etiqueta}
        </span>
      )}
    </div>
  )
}

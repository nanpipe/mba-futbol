'use client'

import { useState, useEffect } from 'react'

export interface ClubInfo {
  id: string
  nombre: string
  slug: string
  timezone: string | null
  plan: string | null
  subscription_status: string | null
  ciudad: string | null
  logo_url: string | null
  color_primary: string | null
  dias_juego: number[] | null
  hora_default: string | null
  hora_apertura_default: string | null
  dias_antes_apertura_default: number | null
}

const FALLBACK: ClubInfo = {
  id: '',
  nombre: 'MBA FC',
  slug: 'mbafc',
  timezone: null,
  plan: null,
  subscription_status: null,
  ciudad: null,
  logo_url: null,
  color_primary: null,
  dias_juego: null,
  hora_default: null,
  hora_apertura_default: null,
  dias_antes_apertura_default: null,
}

// Module-level cache — survives re-renders, resets on cold reload
let _cache: ClubInfo | null = null
let _cacheTs = 0
const CACHE_TTL = 5 * 60 * 1000

export function useClub(): ClubInfo {
  const [club, setClub] = useState<ClubInfo>(_cache ?? FALLBACK)

  useEffect(() => {
    if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
      setClub(_cache)
      return
    }
    fetch('/api/club')
      .then(r => r.json())
      .then(({ club }) => {
        if (club) {
          _cache = club as ClubInfo
          _cacheTs = Date.now()
          setClub(_cache)
        }
      })
      .catch(() => {})
  }, [])

  return club
}

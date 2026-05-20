'use client'

import { useState, useCallback, useEffect } from 'react'

interface Options {
  /** Tab must be active to trigger first load */
  active?: boolean
  /** Key in the JSON response that holds the data array */
  key: string
}

interface Result<T> {
  data: T[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useFetchAdmin<T = Record<string, unknown>>(
  accion: string,
  { active = true, key }: Options
): Result<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin?accion=${accion}`)
      const json = await res.json()
      if (res.ok) {
        setData((json[key] as T[]) ?? [])
      } else {
        setError(`Error ${res.status}: ${json.error ?? 'desconocido'}`)
      }
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }, [accion, key])

  useEffect(() => {
    if (active) reload()
  }, [active, reload])

  return { data, loading, error, reload }
}

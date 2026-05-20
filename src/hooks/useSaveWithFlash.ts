'use client'

import { useState, useRef } from 'react'

interface FlashMessage {
  text: string
  type: 'ok' | 'error'
}

interface Result {
  saving: boolean
  flash: FlashMessage | null
  save: (fn: () => Promise<void>, successMsg?: string) => Promise<void>
  clearFlash: () => void
}

export function useSaveWithFlash(autoHideMs = 3000): Result {
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = async (fn: () => Promise<void>, successMsg = 'Guardado') => {
    setSaving(true)
    setFlash(null)
    try {
      await fn()
      setFlash({ text: successMsg, type: 'ok' })
    } catch (e) {
      setFlash({ text: e instanceof Error ? e.message : 'Error inesperado', type: 'error' })
    } finally {
      setSaving(false)
      if (autoHideMs > 0) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setFlash(null), autoHideMs)
      }
    }
  }

  const clearFlash = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash(null)
  }

  return { saving, flash, save, clearFlash }
}

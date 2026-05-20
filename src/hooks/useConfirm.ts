'use client'

import { useState, useCallback } from 'react'

interface Result {
  pending: boolean
  confirm: (fn: () => Promise<void> | void, message?: string) => Promise<void>
}

/**
 * Wraps window.confirm + async handler.
 * Shows native confirm dialog; runs fn only if user confirms.
 * Sets pending=true while fn executes.
 */
export function useConfirm(): Result {
  const [pending, setPending] = useState(false)

  const confirm = useCallback(async (
    fn: () => Promise<void> | void,
    message = '¿Estás seguro?'
  ) => {
    if (!window.confirm(message)) return
    setPending(true)
    try {
      await fn()
    } finally {
      setPending(false)
    }
  }, [])

  return { pending, confirm }
}

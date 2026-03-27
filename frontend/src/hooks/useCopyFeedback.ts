import { useEffect, useRef, useState } from 'react'

export function useCopyFeedback(durationMs = 1600) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }

      setCopiedKey(key)
      timeoutRef.current = window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current))
      }, durationMs)

      return true
    } catch {
      return false
    }
  }

  return {
    copiedKey,
    copyText,
  }
}

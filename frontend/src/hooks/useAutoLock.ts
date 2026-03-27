import { useEffect } from 'react'
import { useKeystoreStore } from '../stores/keystoreStore'

export function useAutoLock() {
  const lastUnlockAt = useKeystoreStore((state) => state.lastUnlockAt)
  const lockSession = useKeystoreStore((state) => state.lockSession)
  const sessionDurationMs = useKeystoreStore((state) => state.sessionDurationMs)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const touchSession = useKeystoreStore((state) => state.touchSession)

  useEffect(() => {
    if (!storedVault || !lastUnlockAt) {
      return
    }

    const interval = window.setInterval(() => {
      const expiresAt = lastUnlockAt + sessionDurationMs

      if (Date.now() >= expiresAt) {
        lockSession('Session expired. Unlock again to re-enter the vault.')
      }
    }, 15_000)

    const handleActivity = () => touchSession()

    window.addEventListener('pointerdown', handleActivity)
    window.addEventListener('keydown', handleActivity)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pointerdown', handleActivity)
      window.removeEventListener('keydown', handleActivity)
    }
  }, [lastUnlockAt, lockSession, sessionDurationMs, storedVault, touchSession])
}
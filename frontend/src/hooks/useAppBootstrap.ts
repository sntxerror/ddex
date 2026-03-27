import { useEffect } from 'react'
import { useAutoLock } from './useAutoLock'
import { useKeystoreStore } from '../stores/keystoreStore'
import { useWalletStore } from '../stores/walletStore'

export function useAppBootstrap() {
  const initializeKeystore = useKeystoreStore((state) => state.initialize)
  const initializeWasm = useWalletStore((state) => state.initializeWasm)

  useEffect(() => {
    void initializeWasm()
    void initializeKeystore()
  }, [initializeKeystore, initializeWasm])

  useAutoLock()
}
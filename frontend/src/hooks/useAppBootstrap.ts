import { useEffect } from 'react'
import { useAutoLock } from './useAutoLock'
import { useKeystoreStore } from '../stores/keystoreStore'
import { useWalletStore } from '../stores/walletStore'

export function useAppBootstrap() {
  const initializeKeystore = useKeystoreStore((state) => state.initialize)
  const initializeWasm = useWalletStore((state) => state.initializeWasm)
  const restoreSession = useWalletStore((state) => state.restoreSession)
  const wasmStatus = useWalletStore((state) => state.wasmStatus)
  const keystoreStatus = useKeystoreStore((state) => state.status)
  const storedVault = useKeystoreStore((state) => state.storedVault)

  useEffect(() => {
    void initializeWasm()
    void initializeKeystore()
  }, [initializeKeystore, initializeWasm])

  // Once wasm and keystore are ready and there is no encrypted vault, attempt to
  // restore the in-memory wallet from the sessionStorage temp mnemonic (survives
  // page refresh but not tab close).
  useEffect(() => {
    if (wasmStatus === 'ready' && keystoreStatus === 'ready' && !storedVault) {
      void restoreSession()
    }
  }, [wasmStatus, keystoreStatus, storedVault, restoreSession])

  useAutoLock()
}
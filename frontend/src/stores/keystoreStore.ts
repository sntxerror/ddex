import { create } from 'zustand'
import {
  deleteStoredWalletKeystore,
  getStoredWalletKeystoreMetadata,
  isSecureKeystoreSupported,
  saveWalletKeystore,
  unlockStoredWalletMnemonic,
  type StoredWalletKeystoreMetadata,
} from '../keystore/secureKeystore'
import { useOnboardingStore } from './onboardingStore'
import { useWalletStore } from './walletStore'

export type KeystoreStatus = 'checking' | 'ready' | 'unsupported' | 'error'

interface KeystoreState {
  readonly lastUnlockAt: number | null
  readonly sessionDurationMs: number
  readonly status: KeystoreStatus
  readonly storedVault: StoredWalletKeystoreMetadata | null
  readonly working: boolean
  deleteVault: () => Promise<void>
  initialize: () => Promise<void>
  lockSession: (reason?: string) => void
  saveVault: (pin: string) => Promise<boolean>
  touchSession: () => void
  unlockVault: (pin: string) => Promise<boolean>
}

export const useKeystoreStore = create<KeystoreState>((set) => ({
  lastUnlockAt: null,
  sessionDurationMs: 30 * 60 * 1000,
  status: 'checking',
  storedVault: null,
  working: false,

  async initialize() {
    if (!isSecureKeystoreSupported()) {
      set({ status: 'unsupported', storedVault: null })
      return
    }

    try {
      const storedVault = await getStoredWalletKeystoreMetadata()
      set({ status: 'ready', storedVault })
    } catch {
      set({ status: 'error', storedVault: null })
    }
  },

  async saveVault(pin) {
    set({ working: true })

    try {
      const mnemonic = useWalletStore.getState().mnemonic
      const storedVault = await saveWalletKeystore(mnemonic, pin)

      useOnboardingStore.getState().completePassphrase()
      set({ lastUnlockAt: Date.now(), status: 'ready', storedVault, working: false })
      useWalletStore.getState().setFeedback('Encrypted wallet with PIN lock saved locally on this device.')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useWalletStore.getState().setFeedback(message)
      set({ working: false })
      return false
    }
  },

  async unlockVault(pin) {
    set({ working: true })

    try {
      const mnemonic = await unlockStoredWalletMnemonic(pin)
      const ok = await useWalletStore.getState().deriveWallet(mnemonic, {
        successMessage: 'Wallet unlocked from the encrypted device keystore.',
      })

      set({ lastUnlockAt: ok ? Date.now() : null, working: false })
      return ok
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useWalletStore.getState().setFeedback(message)
      set({ working: false })
      return false
    }
  },

  async deleteVault() {
    set({ working: true })

    try {
      await deleteStoredWalletKeystore()
      useWalletStore.getState().clearWallet('Local wallet data deleted and memory cleared.')
      useOnboardingStore.getState().reset()
      set({ lastUnlockAt: null, status: 'ready', storedVault: null, working: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useWalletStore.getState().setFeedback(message)
      set({ working: false })
    }
  },

  lockSession(reason) {
    const storedVault = useKeystoreStore.getState().storedVault

    if (!storedVault) {
      useWalletStore.getState().setFeedback('Save a local PIN lock before locking. Without a stored wallet, locking would remove access from this device.')
      return
    }

    useWalletStore.getState().clearWallet(reason ?? 'Wallet locked.')
    set({ lastUnlockAt: null })
  },

  touchSession() {
    set((state) => (state.storedVault ? { lastUnlockAt: Date.now() } : state))
  },
}))
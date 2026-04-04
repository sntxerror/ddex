import {
  accountKeyFromMnemonic,
  generateMnemonic,
  getAddressForAccount,
  initWalletCore,
  validateMnemonic,
  type WalletAccountKey,
} from '@ddex/wallet-core-web'
import { create } from 'zustand'
import { FOG_CONFIG } from '../config'
import { useBalanceStore } from './balanceStore'
import { useTxHistoryStore } from './txHistoryStore'

const SESSION_MNEMONIC_KEY = 'ddex-temp-mnemonic'

export type WasmStatus = 'idle' | 'loading' | 'ready' | 'error'

interface DeriveWalletOptions {
  readonly successMessage?: string
}

interface WalletState {
  readonly account: WalletAccountKey | null
  readonly address: string
  readonly feedback: string
  readonly isWorking: boolean
  readonly mnemonic: string
  readonly mnemonicDraft: string
  readonly wasmError: string
  readonly wasmStatus: WasmStatus
  clearWallet: (message?: string) => void
  createWallet: () => Promise<boolean>
  deriveWallet: (mnemonic: string, options?: DeriveWalletOptions) => Promise<boolean>
  initializeWasm: () => Promise<void>
  restoreSession: () => Promise<boolean>
  setFeedback: (message: string) => void
  setMnemonicDraft: (value: string) => void
}

function normalizeMnemonic(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function isValidWalletPin(value: string): boolean {
  return /^\d{4,8}$/.test(value.trim())
}

export const useWalletStore = create<WalletState>((set, get) => ({
  account: null,
  address: '',
  feedback: '',
  isWorking: false,
  mnemonic: '',
  mnemonicDraft: '',
  wasmError: '',
  wasmStatus: 'idle',

  async initializeWasm() {
    const { wasmStatus } = get()
    if (wasmStatus === 'ready' || wasmStatus === 'loading') {
      return
    }

    set({ wasmError: '', wasmStatus: 'loading' })

    try {
      await initWalletCore()
      set({ feedback: '', wasmStatus: 'ready' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ wasmError: message, wasmStatus: 'error' })
    }
  },

  setMnemonicDraft(value) {
    set({ mnemonicDraft: value })
  },

  setFeedback(message) {
    set({ feedback: message })
  },

  async deriveWallet(mnemonic, options) {
    const normalizedMnemonic = normalizeMnemonic(mnemonic)

    if (!normalizedMnemonic) {
      set({ feedback: 'Paste or generate a recovery phrase first.' })
      return false
    }

    if (!validateMnemonic(normalizedMnemonic)) {
      set({ feedback: 'That recovery phrase is not a valid BIP-39 English mnemonic.' })
      return false
    }

    const previousAddress = get().address
    set({ account: null, address: '', feedback: '', isWorking: true })

    try {
      const { fogReportUrl, fogAuthoritySpki } = FOG_CONFIG
      const account = await accountKeyFromMnemonic(
        normalizedMnemonic,
        fogReportUrl,
        fogAuthoritySpki,
      )
      const address = await getAddressForAccount(account)

      // Clear stale data from any previous wallet before setting new one
      if (previousAddress !== address) {
        useBalanceStore.getState().reset()
        useTxHistoryStore.getState().reset()
      }

      set({
        account,
        address,
        feedback: options?.successMessage ?? 'Wallet material derived locally in the browser. No server saw the phrase.',
        isWorking: false,
        mnemonic: normalizedMnemonic,
        mnemonicDraft: normalizedMnemonic,
      })

      sessionStorage.setItem(SESSION_MNEMONIC_KEY, normalizedMnemonic)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ feedback: message, isWorking: false })
      return false
    }
  },

  async createWallet() {
    set({ feedback: '', isWorking: true })

    try {
      const mnemonic = await generateMnemonic()
      set({ mnemonicDraft: mnemonic })
      return await get().deriveWallet(mnemonic, {
        successMessage: 'Fresh wallet created locally in your browser. Back it up before you blink.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ feedback: message, isWorking: false })
      return false
    }
  },

  clearWallet(message) {
    sessionStorage.removeItem(SESSION_MNEMONIC_KEY)
    useBalanceStore.getState().reset()
    useTxHistoryStore.getState().reset()
    set({
      account: null,
      address: '',
      feedback: message ?? '',
      isWorking: false,
      mnemonic: '',
      mnemonicDraft: '',
    })
  },

  async restoreSession() {
    const { address } = get()
    if (address) return false
    const saved = sessionStorage.getItem(SESSION_MNEMONIC_KEY)
    if (!saved) return false
    return get().deriveWallet(saved, { successMessage: 'Session restored from this browser tab.' })
  },
}))

export function getMnemonicWordCount(mnemonic: string): number {
  const normalizedMnemonic = normalizeMnemonic(mnemonic)
  return normalizedMnemonic ? normalizedMnemonic.split(' ').length : 0
}
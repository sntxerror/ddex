import type { HeroPanelNotice, HeroPanelTone } from '../components/HeroPanel'
import type { SecureStorageState } from '../components/SecureStoragePanel'
import type { WalletSetupMode } from '../components/WalletSetupPanel'
import type { StoredWalletKeystoreMetadata } from '../keystore/secureKeystore'

export interface UseWalletDashboardOptions {
  readonly fogReportUrl: string
}

export interface UseWalletDashboardResult {
  readonly copiedState: 'mnemonic' | 'address' | null
  readonly displayedMnemonic: string
  readonly handleCopy: (value: string, type: 'mnemonic' | 'address') => Promise<void>
  readonly handleCreate: () => Promise<void>
  readonly handleDeleteStoredWallet: () => Promise<void>
  readonly handleImport: () => Promise<void>
  readonly handleSaveToDevice: () => Promise<void>
  readonly handleUnlockFromDevice: () => Promise<void>
  readonly hasLoadedWallet: boolean
  readonly isAnyWorkInFlight: boolean
  readonly isDraftValid: boolean
  readonly keyMaterialBytes: number
  readonly mnemonicDraft: string
  readonly mnemonicWordCount: number
  readonly mode: WalletSetupMode
  readonly notice: HeroPanelNotice | null
  readonly relockWallet: () => void
  readonly savePassphrase: string
  readonly setMnemonicDraft: (value: string) => void
  readonly setMode: (mode: WalletSetupMode) => void
  readonly setSavePassphrase: (value: string) => void
  readonly setUnlockPassphrase: (value: string) => void
  readonly statusPill: { label: string; tone: HeroPanelTone }
  readonly storageState: SecureStorageState
  readonly storedVault: StoredWalletKeystoreMetadata | null
  readonly unlockPassphrase: string
  readonly walletAddress: string
  readonly wasmReady: boolean
}

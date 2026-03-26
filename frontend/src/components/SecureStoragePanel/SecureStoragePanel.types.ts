import type { StoredWalletKeystoreMetadata } from '../../keystore/secureKeystore'

export type SecureStorageState = 'checking' | 'ready' | 'unsupported' | 'error'

export interface SecureStoragePanelProps {
  readonly hasLoadedWallet: boolean
  readonly onDeleteStoredWallet: () => void
  readonly onRelockWallet: () => void
  readonly onSavePassphraseChange: (value: string) => void
  readonly onSaveToDevice: () => void
  readonly onUnlockFromDevice: () => void
  readonly onUnlockPassphraseChange: (value: string) => void
  readonly savePassphrase: string
  readonly status: SecureStorageState
  readonly storedVault: StoredWalletKeystoreMetadata | null
  readonly unlockPassphrase: string
  readonly working: boolean
}

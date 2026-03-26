export type WalletSetupMode = 'create' | 'import'

export interface WalletSetupPanelProps {
  readonly copiedMnemonic: boolean
  readonly displayedMnemonic: string
  readonly isDraftValid: boolean
  readonly mnemonicDraft: string
  readonly mode: WalletSetupMode
  readonly wasmReady: boolean
  readonly wordCount: number
  readonly working: boolean
  readonly onCopyMnemonic: () => void
  readonly onCreate: () => void
  readonly onDraftChange: (value: string) => void
  readonly onImport: () => void
  readonly onModeChange: (mode: WalletSetupMode) => void
}

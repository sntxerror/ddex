export type OnboardingStep = 'welcome' | 'create' | 'import' | 'backup' | 'backup-check' | 'pin' | 'biometrics' | 'complete'

export interface OnboardingProgress {
  readonly biometricsEnabled: boolean
  readonly mnemonicBackedUp: boolean
  readonly passphraseCreated: boolean
  readonly walletPrepared: boolean
}

export interface SecurityScoreResult {
  readonly achieved: number
  readonly label: string
  readonly pending: string[]
  readonly total: number
}
import { persist } from 'zustand/middleware'
import { create } from 'zustand'
import type { OnboardingStep } from '../types/onboarding'

interface OnboardingState {
  readonly biometricsEnabled: boolean
  readonly importFlow: boolean
  readonly mnemonicBackedUp: boolean
  readonly passphraseCreated: boolean
  readonly walletPrepared: boolean
  completeBiometrics: (enabled: boolean) => void
  completeMnemonicBackup: () => void
  completePassphrase: () => void
  markWalletPrepared: (importFlow: boolean) => void
  reset: () => void
  setCurrentStep: (step: OnboardingStep) => void
  skipBiometrics: () => void
  skipMnemonicBackup: () => void
  skipPassphrase: () => void
}

interface OnboardingPersistedState {
  readonly biometricsEnabled: boolean
  readonly importFlow: boolean
  readonly mnemonicBackedUp: boolean
  readonly passphraseCreated: boolean
  readonly walletPrepared: boolean
}

const initialState: OnboardingPersistedState = {
  biometricsEnabled: false,
  importFlow: false,
  mnemonicBackedUp: false,
  passphraseCreated: false,
  walletPrepared: false,
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      ...initialState,
      completeBiometrics(enabled) {
        set({ biometricsEnabled: enabled })
      },
      completeMnemonicBackup() {
        set({ mnemonicBackedUp: true })
      },
      completePassphrase() {
        set({ passphraseCreated: true })
      },
      markWalletPrepared(importFlow) {
        set({ importFlow, walletPrepared: true })
      },
      reset() {
        set(initialState)
      },
      setCurrentStep(step) {
        void step
        // Route-driven right now; kept for future progress persistence.
      },
      skipBiometrics() {
        set({ biometricsEnabled: false })
      },
      skipMnemonicBackup() {
        set({ mnemonicBackedUp: false })
      },
      skipPassphrase() {
        set({ passphraseCreated: false })
      },
    }),
    {
      name: 'ddex-onboarding',
      partialize: (state) => ({
        biometricsEnabled: state.biometricsEnabled,
        importFlow: state.importFlow,
        mnemonicBackedUp: state.mnemonicBackedUp,
        passphraseCreated: state.passphraseCreated,
        walletPrepared: state.walletPrepared,
      }),
    },
  ),
)
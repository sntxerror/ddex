import { persist } from 'zustand/middleware'
import { create } from 'zustand'
import type { OnboardingStep } from '../types/onboarding'

interface OnboardingState {
  readonly biometricsEnabled: boolean
  readonly biometricsStepReviewed: boolean
  readonly importFlow: boolean
  readonly mnemonicBackedUp: boolean
  readonly mnemonicStepReviewed: boolean
  readonly passphraseCreated: boolean
  readonly passphraseStepReviewed: boolean
  readonly walletPrepared: boolean
  readonly workflowFinished: boolean
  completeBiometrics: (enabled: boolean) => void
  dismissWorkflow: () => void
  completeMnemonicBackup: () => void
  completePassphrase: () => void
  completeWorkflow: () => void
  markWalletPrepared: (importFlow: boolean) => void
  reset: () => void
  setCurrentStep: (step: OnboardingStep) => void
  skipBiometrics: () => void
  skipMnemonicBackup: () => void
  skipPassphrase: () => void
}

interface OnboardingPersistedState {
  readonly biometricsEnabled: boolean
  readonly biometricsStepReviewed: boolean
  readonly importFlow: boolean
  readonly mnemonicBackedUp: boolean
  readonly mnemonicStepReviewed: boolean
  readonly passphraseCreated: boolean
  readonly passphraseStepReviewed: boolean
  readonly walletPrepared: boolean
  readonly workflowFinished: boolean
}

const initialState: OnboardingPersistedState = {
  biometricsEnabled: false,
  biometricsStepReviewed: false,
  importFlow: false,
  mnemonicBackedUp: false,
  mnemonicStepReviewed: false,
  passphraseCreated: false,
  passphraseStepReviewed: false,
  walletPrepared: false,
  workflowFinished: false,
}

export function getNextOnboardingPath(state: OnboardingPersistedState): string | null {
  if (!state.walletPrepared || state.workflowFinished) {
    return null
  }

  if (!state.mnemonicStepReviewed) {
    return '/onboard/backup'
  }

  if (!state.passphraseStepReviewed) {
    return '/onboard/passphrase'
  }

  if (!state.biometricsStepReviewed) {
    return '/onboard/biometrics'
  }

  return '/onboard/complete'
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      ...initialState,
      completeBiometrics(enabled) {
        set({ biometricsEnabled: enabled, biometricsStepReviewed: true })
      },
      dismissWorkflow() {
        set({ workflowFinished: true })
      },
      completeMnemonicBackup() {
        set({ mnemonicBackedUp: true, mnemonicStepReviewed: true })
      },
      completePassphrase() {
        set({ passphraseCreated: true, passphraseStepReviewed: true })
      },
      completeWorkflow() {
        set({ workflowFinished: true })
      },
      markWalletPrepared(importFlow) {
        set({ importFlow, walletPrepared: true, workflowFinished: false })
      },
      reset() {
        set(initialState)
      },
      setCurrentStep(step) {
        void step
        // Route-driven right now; kept for future progress persistence.
      },
      skipBiometrics() {
        set({ biometricsEnabled: false, biometricsStepReviewed: true })
      },
      skipMnemonicBackup() {
        set({ mnemonicBackedUp: false, mnemonicStepReviewed: true })
      },
      skipPassphrase() {
        set({ passphraseCreated: false, passphraseStepReviewed: true })
      },
    }),
    {
      name: 'ddex-onboarding',
      partialize: (state) => ({
        biometricsEnabled: state.biometricsEnabled,
        biometricsStepReviewed: state.biometricsStepReviewed,
        importFlow: state.importFlow,
        mnemonicBackedUp: state.mnemonicBackedUp,
        mnemonicStepReviewed: state.mnemonicStepReviewed,
        passphraseCreated: state.passphraseCreated,
        passphraseStepReviewed: state.passphraseStepReviewed,
        walletPrepared: state.walletPrepared,
        workflowFinished: state.workflowFinished,
      }),
    },
  ),
)
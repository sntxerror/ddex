import { useMemo } from 'react'
import { useOnboardingStore } from '../stores/onboardingStore'
import type { SecurityScoreResult } from '../types/onboarding'

export function useSecurityScore(): SecurityScoreResult {
  const { biometricsEnabled, mnemonicBackedUp, passphraseCreated, walletPrepared } = useOnboardingStore()

  return useMemo(() => {
    let achieved = walletPrepared ? 2 : 0
    const pending: string[] = []

    if (mnemonicBackedUp) {
      achieved += 3
    } else if (walletPrepared) {
      pending.push('Back up your recovery phrase')
    }

    if (passphraseCreated) {
      achieved += 3
    } else if (walletPrepared) {
      pending.push('Set a local PIN lock')
    }

    if (biometricsEnabled) {
      achieved += 2
    } else if (walletPrepared) {
      pending.push('Enable biometric unlock')
    }

    const label = achieved >= 9 ? 'Ultra-Secure' : achieved >= 6 ? 'Strong' : achieved >= 3 ? 'Improving' : 'Starter'

    return {
      achieved,
      label,
      pending,
      total: 10,
    }
  }, [biometricsEnabled, mnemonicBackedUp, passphraseCreated, walletPrepared])
}
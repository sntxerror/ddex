import type { AppNavigationItem, AppView } from '../../types/appShell'

export interface ViewIntroProps {
  readonly currentView: AppView
  readonly hasLoadedWallet: boolean
  readonly navigationItems: readonly AppNavigationItem[]
  readonly storedVaultConfigured: boolean
}

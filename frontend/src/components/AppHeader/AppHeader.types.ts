import type { AppNavigationItem, AppView } from '../../types/appShell'

export interface AppHeaderProps {
  readonly currentView: AppView
  readonly isDark: boolean
  readonly mobileNavigationOpened: boolean
  readonly navigationItems: readonly AppNavigationItem[]
  readonly onCloseMobileNavigation: () => void
  readonly onNavigate: (view: AppView) => void
  readonly onToggleColorScheme: () => void
  readonly onToggleMobileNavigation: () => void
}

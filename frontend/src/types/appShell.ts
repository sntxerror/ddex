import type { TablerIcon } from '@tabler/icons-react'

export type AppView = 'overview' | 'address' | 'settings'

export interface AppNavigationItem {
  readonly description: string
  readonly icon: TablerIcon
  readonly label: string
  readonly value: AppView
}

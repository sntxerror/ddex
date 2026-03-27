export type AppTab = 'wallet' | 'transfer' | 'profile' | 'settings'

export interface AppTabDefinition {
  readonly description: string
  readonly href: string
  readonly label: string
  readonly value: AppTab
}
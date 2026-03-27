export type AppTab = 'wallet' | 'transfer' | 'settings'

export interface AppTabDefinition {
  readonly description: string
  readonly href: string
  readonly label: string
  readonly value: AppTab
}
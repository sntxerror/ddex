export type AppTab = 'vault' | 'transfer' | 'profile'

export interface AppTabDefinition {
  readonly description: string
  readonly href: string
  readonly label: string
  readonly value: AppTab
}
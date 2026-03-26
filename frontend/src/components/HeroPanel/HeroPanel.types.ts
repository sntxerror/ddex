export type HeroPanelTone = 'error' | 'loading' | 'ready'
export type HeroPanelNoticeTone = 'error' | 'info'

export interface HeroPanelNotice {
  readonly message: string
  readonly tone: HeroPanelNoticeTone
}

export interface HeroPanelProps {
  readonly notice: HeroPanelNotice | null
  readonly statusLabel: string
  readonly statusTone: HeroPanelTone
}

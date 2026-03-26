import type { ReactNode } from 'react'

export type HeroPanelTone = 'error' | 'loading' | 'ready'
export type HeroPanelNoticeTone = 'error' | 'info'

export interface HeroPanelStat {
  readonly label: string
  readonly value: string
}

export interface HeroPanelNotice {
  readonly message: string
  readonly tone: HeroPanelNoticeTone
}

export interface HeroPanelProps {
  readonly aside?: ReactNode
  readonly description: string
  readonly eyebrow: string
  readonly highlights: readonly string[]
  readonly notice: HeroPanelNotice | null
  readonly statusLabel: string
  readonly stats: readonly HeroPanelStat[]
  readonly title: string
  readonly statusTone: HeroPanelTone
}

export interface OverviewPanelItem {
  readonly description: string
  readonly label: string
  readonly value: string
}

export interface OverviewPanelProps {
  readonly fogReportUrl: string
  readonly keyMaterialBytes: number
  readonly onOpenAddress: () => void
  readonly onOpenSettings: () => void
  readonly securityChecklist: readonly string[]
  readonly summaryItems: readonly OverviewPanelItem[]
}

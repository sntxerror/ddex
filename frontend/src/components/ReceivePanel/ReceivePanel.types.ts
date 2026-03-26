export interface ReceivePanelProps {
  readonly copiedAddress: boolean
  readonly fogReportUrl: string
  readonly keyMaterialBytes: number
  readonly onCopyAddress: () => void
  readonly walletAddress: string
}

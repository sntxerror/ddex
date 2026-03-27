import { create } from 'zustand'

interface TransferState {
  readonly amount: string
  readonly recipient: string
  readonly submissionState: 'idle' | 'ready' | 'disabled'
  setAmount: (amount: string) => void
  setRecipient: (recipient: string) => void
}

export const useTransferStore = create<TransferState>((set) => ({
  amount: '',
  recipient: '',
  submissionState: 'disabled',
  setAmount(amount) {
    set((state) => ({
      amount,
      submissionState: amount.trim() && state.recipient.trim() ? 'ready' : 'disabled',
    }))
  },
  setRecipient(recipient) {
    set((state) => ({
      recipient,
      submissionState: state.amount.trim() && recipient.trim() ? 'ready' : 'disabled',
    }))
  },
}))
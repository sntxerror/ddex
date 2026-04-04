import { create } from 'zustand'
import { sendTransaction, type TxBuildPhase, type SendResult } from '../services/txBuilder'
import { useWalletStore } from './walletStore'
import { useBalanceStore } from './balanceStore'
import { useTxHistoryStore } from './txHistoryStore'

const PICO_MOB = 1_000_000_000_000n

export type TransferStatus =
  | 'idle'
  | 'ready'
  | 'building'
  | 'submitting'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired'

interface TransferState {
  readonly amount: string
  readonly recipient: string
  readonly status: TransferStatus
  readonly buildPhase: TxBuildPhase | null
  readonly buildDetail: string
  readonly error: string
  readonly txPrefixHash: string
  readonly tombstoneBlock: bigint | null

  setAmount: (amount: string) => void
  setRecipient: (recipient: string) => void
  send: () => Promise<void>
  reset: () => void
}

function canSend(amount: string, recipient: string): boolean {
  return amount.trim().length > 0 && recipient.trim().length > 0
}

function mobToPicoMob(mob: string): bigint {
  const trimmed = mob.trim()
  const parts = trimmed.split('.')
  const whole = parts[0] || '0'
  const frac = (parts[1] || '').padEnd(12, '0').slice(0, 12)
  return BigInt(whole) * PICO_MOB + BigInt(frac)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const useTransferStore = create<TransferState>((set, get) => ({
  amount: '',
  recipient: '',
  status: 'idle',
  buildPhase: null,
  buildDetail: '',
  error: '',
  txPrefixHash: '',
  tombstoneBlock: null,

  setAmount(amount) {
    set({
      amount,
      status: canSend(amount, get().recipient) ? 'ready' : 'idle',
      error: '',
    })
  },

  setRecipient(recipient) {
    set({
      recipient,
      status: canSend(get().amount, recipient) ? 'ready' : 'idle',
      error: '',
    })
  },

  async send() {
    const { amount, recipient, status } = get()
    if (status !== 'ready') return

    const account = useWalletStore.getState().account
    if (!account) {
      set({ error: 'Wallet not unlocked', status: 'failed' })
      return
    }

    const ownedTxOuts = useBalanceStore.getState().ownedTxOuts
    if (ownedTxOuts.length === 0) {
      set({ error: 'No spendable outputs. Sync balance first.', status: 'failed' })
      return
    }

    let picoAmount: bigint
    try {
      picoAmount = mobToPicoMob(amount)
      if (picoAmount <= 0n) throw new Error('Amount must be positive')
    } catch {
      set({ error: 'Invalid amount', status: 'failed' })
      return
    }

    set({ status: 'building', buildPhase: 'validating', buildDetail: '', error: '' })

    const result: SendResult = await sendTransaction(
      account,
      ownedTxOuts,
      recipient,
      picoAmount,
      (progress) => {
        const newStatus: TransferStatus =
          progress.phase === 'submitting' ? 'submitting' : 'building'
        set({
          status: newStatus,
          buildPhase: progress.phase,
          buildDetail: progress.detail ?? '',
        })
      },
    )

    if (result.success) {
      const txHash = result.txPrefixHash ? bytesToHex(result.txPrefixHash) : `sent-${Date.now()}`

      set({
        status: 'submitted',
        buildPhase: 'done',
        buildDetail: `Accepted at block ~${result.blockCount}`,
        txPrefixHash: result.txPrefixHash ? bytesToHex(result.txPrefixHash) : '',
        tombstoneBlock: result.tombstoneBlock ?? null,
        error: '',
      })

      // Record sent transaction in history
      useTxHistoryStore.getState().recordSentTx({
        txId: txHash,
        amount: picoAmount,
        fee: 400_000_000n, // MINIMUM_FEE
        recipientB58: recipient,
        tombstoneBlock: result.tombstoneBlock ?? 0n,
        inputKeyImages: result.keyImages ?? [],
      })

      // Trigger a re-sync so spent inputs are reflected
      const walletAccount = useWalletStore.getState().account
      if (walletAccount) {
        useBalanceStore.getState().sync(walletAccount).catch(() => {})
      }
    } else {
      set({
        status: 'failed',
        buildPhase: 'error',
        buildDetail: '',
        error: result.error ?? 'Unknown error',
      })
    }
  },

  reset() {
    set({
      amount: '',
      recipient: '',
      status: 'idle',
      buildPhase: null,
      buildDetail: '',
      error: '',
      txPrefixHash: '',
      tombstoneBlock: null,
    })
  },
}))
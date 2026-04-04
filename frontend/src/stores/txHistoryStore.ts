import { create } from 'zustand'
import type { OwnedTxOut } from '../services/fogClient'
import { formatMob } from './balanceStore'

// ── Types ──

export type TxDirection = 'received' | 'sent'
export type TxStatus = 'confirmed' | 'pending' | 'expired'

export interface TransactionRecord {
  /** Unique ID: globalIndex for received, prefixHash for sent */
  readonly id: string
  readonly direction: TxDirection
  /** picoMOB as bigint */
  readonly amount: bigint
  /** picoMOB fee (sent only) */
  readonly fee: bigint
  readonly status: TxStatus
  /** Unix timestamp ms when first discovered / submitted */
  readonly timestamp: number
  /** Block index (received: creation block, sent: submission block) */
  readonly blockIndex: string
  /** Recipient b58 address (sent only) */
  readonly recipientB58: string
  /** Tombstone block (sent only) */
  readonly tombstoneBlock: string
  /** Memo type (0x0000=none, 0x0100=authenticated sender, 0x0101=sender+payment req) */
  readonly memoType: number
  /** Sender address hash from authenticated memo (16 bytes hex) */
  readonly senderAddressHash: string
}

// ── localStorage persistence ──

const STORAGE_KEY = 'ddex-tx-history'
const MAX_HISTORY = 100

interface SerializedRecord {
  id: string
  direction: TxDirection
  amount: string
  fee: string
  status: TxStatus
  timestamp: number
  blockIndex: string
  recipientB58: string
  tombstoneBlock: string
  memoType: number
  senderAddressHash: string
}

function serialize(records: TransactionRecord[]): string {
  const data: SerializedRecord[] = records.map((r) => ({
    id: r.id,
    direction: r.direction,
    amount: r.amount.toString(),
    fee: r.fee.toString(),
    status: r.status,
    timestamp: r.timestamp,
    blockIndex: r.blockIndex,
    recipientB58: r.recipientB58,
    tombstoneBlock: r.tombstoneBlock,
    memoType: r.memoType,
    senderAddressHash: r.senderAddressHash,
  }))
  return JSON.stringify(data)
}

function deserialize(raw: string): TransactionRecord[] {
  try {
    const data: SerializedRecord[] = JSON.parse(raw)
    return data.map((d) => ({
      id: d.id,
      direction: d.direction,
      amount: BigInt(d.amount),
      fee: BigInt(d.fee || '0'),
      status: d.status,
      timestamp: d.timestamp,
      blockIndex: d.blockIndex,
      recipientB58: d.recipientB58 || '',
      tombstoneBlock: d.tombstoneBlock || '',
      memoType: d.memoType ?? 0,
      senderAddressHash: d.senderAddressHash ?? '',
    }))
  } catch {
    return []
  }
}

function loadHistory(): TransactionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return deserialize(raw)
  } catch {
    return []
  }
}

function saveHistory(records: TransactionRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(records.slice(0, MAX_HISTORY)))
  } catch {
    // Best-effort
  }
}

// ── Store ──

interface TxHistoryState {
  readonly records: TransactionRecord[]

  /**
   * Reconcile owned TxOuts from fog sync into received transaction records.
   * New TxOuts (by globalIndex) are appended; spent status is updated.
   */
  recordReceivedTxOuts: (ownedTxOuts: OwnedTxOut[]) => void

  /**
   * Record a sent transaction (called from transferStore after submission).
   */
  recordSentTx: (params: {
    txId: string
    amount: bigint
    fee: bigint
    recipientB58: string
    tombstoneBlock: bigint
    inputKeyImages: Uint8Array[]
  }) => void

  /**
   * Mark a pending sent tx as confirmed (when key images show spent).
   */
  confirmSentTx: (txId: string) => void

  /**
   * Mark a pending sent tx as expired (past tombstone block).
   */
  expireSentTx: (txId: string) => void

  /**
   * Clear all history (e.g. on wallet reset).
   */
  reset: () => void
}

export const useTxHistoryStore = create<TxHistoryState>((set, get) => ({
  records: loadHistory(),

  recordReceivedTxOuts(ownedTxOuts) {
    const current = get().records
    const existingIds = new Set(current.map((r) => r.id))

    const newRecords: TransactionRecord[] = []

    for (const txo of ownedTxOuts) {
      // Use globalIndex as unique ID for received transactions
      const id = `rx-${txo.globalIndex}`
      if (existingIds.has(id)) continue

      // Only track MOB (tokenId 0)
      if (txo.tokenId !== 0n) continue

      const memo = txo.memo

      // Determine direction from subaddress index and memo type:
      //   subaddr 0 = default → received payment (memo 0x0100/0x0101 = AuthenticatedSender)
      //   subaddr 1 = change  → change output from OUR send (memo 0x0200 = DestinationMemo)
      const isChangeOutput = txo.subaddressIndex === 1 || memo?.memo_type === 0x0200
      const direction: TxDirection = isChangeOutput ? 'sent' : 'received'

      const senderHash = memo?.sender_address_hash
        ? Array.from(memo.sender_address_hash).map(b => b.toString(16).padStart(2, '0')).join('')
        : ''

      // For DestinationMemo (change outputs), extract the destination address hash
      const destHash = memo?.destination_address_hash
        ? Array.from(memo.destination_address_hash).map(b => b.toString(16).padStart(2, '0')).join('')
        : ''

      // Use block timestamp from fog if available, otherwise discovery time
      const timestamp = txo.timestamp > 0 ? txo.timestamp * 1000 : Date.now()

      // Compute amount for sent (change) transactions:
      // 1. If DestinationMemo total_outlay is available, use it (sent + fee)
      // 2. Otherwise, correlate: sent = sum(inputs spent at this block) − change value
      // 3. Fallback: skip change outputs with unknown amounts
      let amount = txo.value
      if (isChangeOutput) {
        if (memo?.total_outlay) {
          amount = BigInt(memo.total_outlay)
        } else {
          // Find all inputs consumed in the same block as this change output
          const inputsSpentHere = ownedTxOuts.filter(
            t => t.spent && t.spentAtBlock === txo.blockIndex && t.globalIndex !== txo.globalIndex
          )
          if (inputsSpentHere.length > 0) {
            const inputSum = inputsSpentHere.reduce((sum, t) => sum + t.value, 0n)
            amount = inputSum - txo.value // = actual sent + fee
          } else {
            // Can't determine send amount — skip this change output
            continue
          }
        }
      }

      newRecords.push({
        id,
        direction,
        amount,
        fee: 0n,
        status: 'confirmed',
        timestamp,
        blockIndex: txo.blockIndex,
        recipientB58: '',
        tombstoneBlock: '',
        memoType: memo?.memo_type ?? 0,
        senderAddressHash: direction === 'received' ? senderHash : destHash,
      })
    }

    if (newRecords.length === 0) return

    // Prepend new records (newest first), cap at MAX_HISTORY
    const merged = [...newRecords, ...current].slice(0, MAX_HISTORY)
    // Sort by block index descending (higher block = more recent)
    merged.sort((a, b) => {
      const blockA = BigInt(a.blockIndex || '0')
      const blockB = BigInt(b.blockIndex || '0')
      if (blockB !== blockA) return blockB > blockA ? 1 : -1
      return b.timestamp - a.timestamp
    })

    set({ records: merged })
    saveHistory(merged)
  },

  recordSentTx({ txId, amount, fee, recipientB58, tombstoneBlock }) {
    const current = get().records
    const id = `tx-${txId}`

    if (current.some((r) => r.id === id)) return

    const record: TransactionRecord = {
      id,
      direction: 'sent',
      amount,
      fee,
      status: 'pending',
      timestamp: Date.now(),
      blockIndex: '',
      recipientB58,
      tombstoneBlock: tombstoneBlock.toString(),
      memoType: 0x0100,
      senderAddressHash: '',
    }

    const merged = [record, ...current].slice(0, MAX_HISTORY)
    set({ records: merged })
    saveHistory(merged)
  },

  confirmSentTx(txId) {
    const current = get().records
    const idx = current.findIndex((r) => r.id === `tx-${txId}`)
    if (idx === -1) return

    const updated = [...current]
    updated[idx] = { ...updated[idx], status: 'confirmed' }
    set({ records: updated })
    saveHistory(updated)
  },

  expireSentTx(txId) {
    const current = get().records
    const idx = current.findIndex((r) => r.id === `tx-${txId}`)
    if (idx === -1) return

    const updated = [...current]
    updated[idx] = { ...updated[idx], status: 'expired' }
    set({ records: updated })
    saveHistory(updated)
  },

  reset() {
    localStorage.removeItem(STORAGE_KEY)
    set({ records: [] })
  },
}))

// ── Formatting helpers ──

export function formatTxAmount(record: TransactionRecord): string {
  const mob = formatMob(record.amount)
  return record.direction === 'received' ? `+${mob}` : `-${mob}`
}

/**
 * Show relative or absolute time for transactions.
 * Uses block timestamps from fog when available (seconds since epoch → ms).
 * Falls back to block index for old transactions without timestamps.
 */
export function formatTxTimestamp(record: TransactionRecord): string {
  const now = Date.now()
  const diffMs = now - record.timestamp
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHrs = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  // Recent: relative time
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHrs < 24) return `${diffHrs}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  // If timestamp looks like a real date (not just discovery time within the last minute),
  // display it as a calendar date
  if (record.timestamp > 1_000_000_000_000) { // after ~2001 in ms
    return new Date(record.timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  // Fallback: block index
  if (record.blockIndex) return `Block ${record.blockIndex}`
  return ''
}

export function txStatusBadge(record: TransactionRecord): string {
  if (record.status === 'pending') return 'PENDING'
  if (record.status === 'expired') return 'EXPIRED'
  if (record.direction === 'received' && (record.memoType === 0x0100 || record.memoType === 0x0101)) {
    return 'VERIFIED'
  }
  if (record.direction === 'received') return 'RECEIVED'
  return 'SENT'
}

/** Primary label — block info, truncated addresses, or status context */
export function txTitle(record: TransactionRecord): string {
  if (record.direction === 'sent') {
    if (record.status === 'pending') return 'Sending…'
    if (record.status === 'expired') return `Expired · tombstone ${record.tombstoneBlock}`
    // For change-output-derived sends, senderAddressHash holds destination hash
    if (record.recipientB58) {
      return `Sent · to ${record.recipientB58.slice(0, 6)}…${record.recipientB58.slice(-4)}`
    }
    if (record.senderAddressHash) {
      return `Sent · to ${record.senderAddressHash.slice(0, 8)}…`
    }
    return `Sent · Block ${record.blockIndex || '?'}`
  }
  // Received
  if (record.senderAddressHash) {
    return `Received · from ${record.senderAddressHash.slice(0, 8)}…`
  }
  if (record.blockIndex) return `Received · Block ${record.blockIndex}`
  return 'Received'
}

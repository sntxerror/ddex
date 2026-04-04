import { create } from 'zustand'
import {
  syncFogBalance,
  resetFogConnections,
  type OwnedTxOut,
  type FogSyncProgress,
} from '../services/fogClient'
import type { WalletAccountKey } from '@ddex/wallet-core-web'
import { useTxHistoryStore } from './txHistoryStore'

const PICO_MOB = 1_000_000_000_000n
const SESSION_BALANCE_KEY = 'ddex-balance-cache'

export type BalanceSyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

// ── sessionStorage serialization helpers ──

interface SerializedBalanceCache {
  balancePicoMob: string
  highestProcessedBlock: string
  lastSyncedAt: number
  ownedTxOuts: Array<{
    globalIndex: string
    blockIndex: string
    timestamp?: number
    value: string
    tokenId: string
    keyImage: string       // hex
    subaddressIndex: number
    spent: boolean
    spentAtBlock?: string
    memoType?: number
    senderAddressHash?: string   // hex
    paymentRequestId?: string
  }>
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return arr
}

function saveBalanceToSession(state: {
  balancePicoMob: bigint
  highestProcessedBlock: string
  lastSyncedAt: number | null
  ownedTxOuts: OwnedTxOut[]
}): void {
  if (!state.lastSyncedAt) return
  try {
    const data: SerializedBalanceCache = {
      balancePicoMob: state.balancePicoMob.toString(),
      highestProcessedBlock: state.highestProcessedBlock,
      lastSyncedAt: state.lastSyncedAt,
      ownedTxOuts: state.ownedTxOuts.map((t) => ({
        globalIndex: t.globalIndex,
        blockIndex: t.blockIndex,
        timestamp: t.timestamp,
        value: t.value.toString(),
        tokenId: t.tokenId.toString(),
        keyImage: toHex(t.keyImage),
        subaddressIndex: t.subaddressIndex,
        spent: t.spent,
        spentAtBlock: t.spentAtBlock,
        memoType: t.memo?.memo_type,
        senderAddressHash: t.memo?.sender_address_hash
          ? toHex(new Uint8Array(t.memo.sender_address_hash))
          : undefined,
        paymentRequestId: t.memo?.payment_request_id,
      })),
    }
    sessionStorage.setItem(SESSION_BALANCE_KEY, JSON.stringify(data))
  } catch {
    // Best-effort — sessionStorage may be full or unavailable
  }
}

function loadBalanceFromSession(): {
  balancePicoMob: bigint
  highestProcessedBlock: string
  lastSyncedAt: number
  ownedTxOuts: OwnedTxOut[]
} | null {
  try {
    const raw = sessionStorage.getItem(SESSION_BALANCE_KEY)
    if (!raw) return null
    const data: SerializedBalanceCache = JSON.parse(raw)
    return {
      balancePicoMob: BigInt(data.balancePicoMob),
      highestProcessedBlock: data.highestProcessedBlock,
      lastSyncedAt: data.lastSyncedAt,
      ownedTxOuts: data.ownedTxOuts.map((t) => ({
        globalIndex: t.globalIndex,
        blockIndex: t.blockIndex,
        timestamp: t.timestamp ?? 0,
        value: BigInt(t.value),
        tokenId: BigInt(t.tokenId),
        keyImage: fromHex(t.keyImage),
        subaddressIndex: t.subaddressIndex,
        spent: t.spent,
        spentAtBlock: t.spentAtBlock ?? '0',
        memo: t.memoType != null
          ? {
              memo_type: t.memoType,
              sender_address_hash: t.senderAddressHash
                ? Array.from(fromHex(t.senderAddressHash))
                : undefined,
              payment_request_id: t.paymentRequestId,
            }
          : null,
      })),
    }
  } catch {
    return null
  }
}

// ── Initial state from cache ──

const cached = loadBalanceFromSession()

interface BalanceState {
  /** picoMOB balance (unspent MOB only) */
  readonly balancePicoMob: bigint
  readonly syncStatus: BalanceSyncStatus
  readonly syncPhase: FogSyncProgress['phase']
  readonly syncDetail: string
  readonly syncError: string
  readonly highestProcessedBlock: string
  readonly lastSyncedAt: number | null
  readonly ownedTxOuts: OwnedTxOut[]

  sync: (account: WalletAccountKey, signal?: AbortSignal) => Promise<void>
  reset: () => void
}

export const useBalanceStore = create<BalanceState>((set, get) => ({
  balancePicoMob: cached?.balancePicoMob ?? 0n,
  syncStatus: cached ? 'synced' : 'idle',
  syncPhase: 'done',
  syncDetail: '',
  syncError: '',
  highestProcessedBlock: cached?.highestProcessedBlock ?? '0',
  lastSyncedAt: cached?.lastSyncedAt ?? null,
  ownedTxOuts: cached?.ownedTxOuts ?? [],

  async sync(account, signal) {
    if (get().syncStatus === 'syncing') return

    set({ syncStatus: 'syncing', syncError: '', syncPhase: 'attesting', syncDetail: '' })

    try {
      const result = await syncFogBalance(account, (progress) => {
        set({ syncPhase: progress.phase, syncDetail: progress.detail ?? '' })
      }, signal, (partial) => {
        // Progressive balance update — show running balance as scanning progresses
        set({
          balancePicoMob: partial.totalBalance,
          highestProcessedBlock: partial.highestProcessedBlock,
          ownedTxOuts: partial.ownedTxOuts,
        })
        // Record discovered TxOuts as received transactions
        useTxHistoryStore.getState().recordReceivedTxOuts(partial.ownedTxOuts)
      })

      set({
        balancePicoMob: result.totalBalance,
        highestProcessedBlock: result.highestProcessedBlock,
        lastSyncedAt: result.syncedAt,
        ownedTxOuts: result.ownedTxOuts,
        syncStatus: 'synced',
        syncPhase: 'done',
        syncDetail: '',
      })
      // Final reconcile of all owned TxOuts into transaction history
      useTxHistoryStore.getState().recordReceivedTxOuts(result.ownedTxOuts)
      saveBalanceToSession({
        balancePicoMob: result.totalBalance,
        highestProcessedBlock: result.highestProcessedBlock,
        lastSyncedAt: result.syncedAt,
        ownedTxOuts: result.ownedTxOuts,
      })
    } catch (err) {
      // Abort errors are not real failures — silently reset to idle
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.log('[balance] Fog sync aborted (component unmount or navigation)')
        set({ syncStatus: 'idle', syncPhase: 'done', syncDetail: '' })
        return
      }

      const message = err instanceof Error ? err.message : String(err)
      console.error('[balance] Fog sync failed:', message)
      set({
        syncStatus: 'error',
        syncPhase: 'error',
        syncError: message,
        syncDetail: '',
      })
    }
  },

  reset() {
    resetFogConnections()
    sessionStorage.removeItem(SESSION_BALANCE_KEY)
    set({
      balancePicoMob: 0n,
      syncStatus: 'idle',
      syncPhase: 'done',
      syncDetail: '',
      syncError: '',
      highestProcessedBlock: '0',
      lastSyncedAt: null,
      ownedTxOuts: [],
    })
  },
}))

/** Format picoMOB to human-readable MOB string (3 decimal places) */
export function formatMob(picoMob: bigint): string {
  const whole = picoMob / PICO_MOB
  const frac = picoMob % PICO_MOB
  const fracStr = frac.toString().padStart(12, '0').slice(0, 3)
  return `${whole}.${fracStr}`
}

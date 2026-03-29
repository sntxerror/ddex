import { create } from 'zustand'
import {
  syncFogBalance,
  resetFogConnections,
  type OwnedTxOut,
  type FogSyncProgress,
} from '../services/fogClient'
import type { WalletAccountKey } from '@ddex/wallet-core-web'

const PICO_MOB = 1_000_000_000_000n

export type BalanceSyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

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
  balancePicoMob: 0n,
  syncStatus: 'idle',
  syncPhase: 'done',
  syncDetail: '',
  syncError: '',
  highestProcessedBlock: '0',
  lastSyncedAt: null,
  ownedTxOuts: [],

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

/** Format picoMOB to human-readable MOB string */
export function formatMob(picoMob: bigint): string {
  const whole = picoMob / PICO_MOB
  const frac = picoMob % PICO_MOB
  const fracStr = frac.toString().padStart(12, '0').slice(0, 2)
  return `${whole}.${fracStr}`
}

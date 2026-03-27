import { persist } from 'zustand/middleware'
import { create } from 'zustand'

export type NetworkName = 'testnet' | 'mainnet'
export type NetworkSyncStatus = 'active' | 'degraded' | 'offline'

interface NetworkState {
  readonly network: NetworkName
  readonly syncStatus: NetworkSyncStatus
  setNetwork: (network: NetworkName) => void
  setSyncStatus: (status: NetworkSyncStatus) => void
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      network: 'testnet',
      syncStatus: 'active',
      setNetwork(network) {
        set({ network })
      },
      setSyncStatus(syncStatus) {
        set({ syncStatus })
      },
    }),
    { name: 'ddex-network' },
  ),
)
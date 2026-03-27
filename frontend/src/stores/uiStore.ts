import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  readonly amountsHidden: boolean
  reset: () => void
  setAmountsHidden: (hidden: boolean) => void
  toggleAmountsHidden: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      amountsHidden: false,
      reset() {
        set({ amountsHidden: false })
      },
      setAmountsHidden(hidden) {
        set({ amountsHidden: hidden })
      },
      toggleAmountsHidden() {
        set((state) => ({ amountsHidden: !state.amountsHidden }))
      },
    }),
    {
      name: 'ddex-ui',
      partialize: (state) => ({ amountsHidden: state.amountsHidden }),
    },
  ),
)

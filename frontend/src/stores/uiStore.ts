import { create } from 'zustand'

interface UiState {
  readonly amountsHidden: boolean
  toggleAmountsHidden: () => void
}

export const useUiStore = create<UiState>((set) => ({
  amountsHidden: false,
  toggleAmountsHidden() {
    set((state) => ({ amountsHidden: !state.amountsHidden }))
  },
}))

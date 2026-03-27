import {
  accountKeyFromMnemonic,
  generateMnemonic,
  getAddressForAccount,
  initWalletCore,
  validateMnemonic,
  type WalletAccountKey,
} from '@ddex/wallet-core-web'
import { useEffect, useMemo, useState } from 'react'
import type { HeroPanelNotice, HeroPanelTone } from '../components/HeroPanel'
import type { SecureStorageState } from '../components/SecureStoragePanel'
import type { WalletSetupMode } from '../components/WalletSetupPanel'
import { FOG_CONFIG } from '../config'
import {
  deleteStoredWalletKeystore,
  getStoredWalletKeystoreMetadata,
  isSecureKeystoreSupported,
  saveWalletKeystore,
  unlockStoredWalletMnemonic,
  type StoredWalletKeystoreMetadata,
} from '../keystore/secureKeystore'
import type {
  UseWalletDashboardResult,
} from './useWalletDashboard.types'

type WasmStatus = 'loading' | 'ready' | 'error'

export function useWalletDashboard(): UseWalletDashboardResult {
  const [wasmStatus, setWasmStatus] = useState<WasmStatus>('loading')
  const [wasmError, setWasmError] = useState('')
  const [mode, setMode] = useState<WalletSetupMode>('create')
  const [working, setWorking] = useState(false)
  const [mnemonicDraft, setMnemonicDraft] = useState('')
  const [walletMnemonic, setWalletMnemonic] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [walletAccount, setWalletAccount] = useState<WalletAccountKey | null>(null)
  const [storedVault, setStoredVault] = useState<StoredWalletKeystoreMetadata | null>(null)
  const [storageState, setStorageState] = useState<SecureStorageState>('checking')
  const [storageWorking, setStorageWorking] = useState(false)
  const [savePassphrase, setSavePassphrase] = useState('')
  const [unlockPassphrase, setUnlockPassphrase] = useState('')
  const [feedback, setFeedback] = useState('')
  const [copiedState, setCopiedState] = useState<'mnemonic' | 'address' | null>(null)

  const refreshStoredVaultState = async () => {
    if (!isSecureKeystoreSupported()) {
      setStoredVault(null)
      setStorageState('unsupported')
      return
    }

    try {
      const metadata = await getStoredWalletKeystoreMetadata()
      setStoredVault(metadata)
      setStorageState('ready')
    } catch {
      setStoredVault(null)
      setStorageState('error')
    }
  }

  useEffect(() => {
    let cancelled = false

    initWalletCore()
      .then(() => {
        if (!cancelled) {
          setWasmStatus('ready')
          setFeedback('wallet-core is ready for local wallet derivation.')
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setWasmStatus('error')
        setWasmError(message)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void refreshStoredVaultState()
  }, [])

  const normalizedDraft = useMemo(
    () => mnemonicDraft.trim().replace(/\s+/g, ' '),
    [mnemonicDraft],
  )

  const mnemonicWordCount = useMemo(() => {
    const source = walletMnemonic || mnemonicDraft
    return source.trim() ? source.trim().split(/\s+/).length : 0
  }, [mnemonicDraft, walletMnemonic])

  const isDraftValid = useMemo(() => {
    return normalizedDraft.length > 0 && validateMnemonic(normalizedDraft)
  }, [normalizedDraft])

  const deriveWallet = async (phrase: string, successMessage?: string) => {
    setWorking(true)
    setFeedback('')
    setWalletAddress('')
    setWalletAccount(null)

    try {
      const { fogReportUrl, fogAuthoritySpki } = FOG_CONFIG
      const account = await accountKeyFromMnemonic(
        phrase,
        fogReportUrl,
        fogAuthoritySpki,
      )
      const address = await getAddressForAccount(account)
      setWalletMnemonic(phrase)
      setWalletAccount(account)
      setWalletAddress(address)
      setFeedback(
        successMessage ?? 'Wallet material derived locally in the browser. No server saw the phrase.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFeedback(message)
    } finally {
      setWorking(false)
    }
  }

  const relockWallet = () => {
    setMnemonicDraft('')
    setWalletMnemonic('')
    setWalletAddress('')
    setWalletAccount(null)
    setCopiedState(null)
    setFeedback(
      storedVault
        ? 'Wallet relocked. The encrypted IndexedDB vault is still available on this device.'
        : 'Wallet relocked from memory.',
    )
  }

  const handleCreate = async () => {
    try {
      setWorking(true)
      const phrase = await generateMnemonic()
      setMnemonicDraft(phrase)
      await deriveWallet(phrase)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFeedback(message)
      setWorking(false)
    }
  }

  const handleImport = async () => {
    if (!normalizedDraft) {
      setFeedback('Paste a recovery phrase first.')
      return
    }

    if (!isDraftValid) {
      setFeedback('That recovery phrase is not a valid BIP-39 English mnemonic.')
      return
    }

    await deriveWallet(normalizedDraft)
  }

  const handleCopy = async (value: string, type: 'mnemonic' | 'address') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedState(type)
      window.setTimeout(() => {
        setCopiedState((current) => (current === type ? null : current))
      }, 1600)
    } catch {
      setFeedback('Clipboard access was denied. Old-school copy still works, promise.')
    }
  }

  const handleSaveToDevice = async () => {
    setStorageWorking(true)

    try {
      await saveWalletKeystore(walletMnemonic, savePassphrase)
      await refreshStoredVaultState()
      setSavePassphrase('')
      setFeedback(
        storedVault
          ? 'Encrypted IndexedDB vault updated for this browser profile.'
          : 'Encrypted IndexedDB vault saved locally for this browser profile.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFeedback(message)
    } finally {
      setStorageWorking(false)
    }
  }

  const handleUnlockFromDevice = async () => {
    setStorageWorking(true)

    try {
      const phrase = await unlockStoredWalletMnemonic(unlockPassphrase)
      setMode('import')
      setMnemonicDraft(phrase)
      setUnlockPassphrase('')
      await deriveWallet(
        phrase,
        'Wallet unlocked from the encrypted IndexedDB vault and re-derived locally in the browser.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFeedback(message)
    } finally {
      setStorageWorking(false)
    }
  }

  const handleDeleteStoredWallet = async () => {
    setStorageWorking(true)

    try {
      await deleteStoredWalletKeystore()
      await refreshStoredVaultState()
      setSavePassphrase('')
      setUnlockPassphrase('')
      setFeedback('Encrypted IndexedDB vault removed from this browser profile.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFeedback(message)
    } finally {
      setStorageWorking(false)
    }
  }

  const statusPill: { label: string; tone: HeroPanelTone } = wasmStatus === 'ready'
    ? { label: 'wallet-core ready', tone: 'ready' }
    : wasmStatus === 'error'
      ? { label: 'wallet-core failed', tone: 'error' }
      : { label: 'loading wallet-core', tone: 'loading' }

  const notice: HeroPanelNotice | null = wasmStatus === 'error'
    ? { message: wasmError, tone: 'error' }
    : feedback
      ? { message: feedback, tone: 'info' }
      : null

  const keyMaterialBytes = walletAccount
    ? walletAccount.view_private_key.length + walletAccount.spend_private_key.length
    : 0

  const displayedMnemonic = walletMnemonic || mnemonicDraft
  const hasLoadedWallet = walletMnemonic.length > 0 && walletAddress.length > 0
  const isAnyWorkInFlight = working || storageWorking

  return {
    copiedState,
    displayedMnemonic,
    handleCopy,
    handleCreate,
    handleDeleteStoredWallet,
    handleImport,
    handleSaveToDevice,
    handleUnlockFromDevice,
    hasLoadedWallet,
    isAnyWorkInFlight,
    isDraftValid,
    keyMaterialBytes,
    mnemonicDraft,
    mnemonicWordCount,
    mode,
    notice,
    relockWallet,
    savePassphrase,
    setMnemonicDraft,
    setMode,
    setSavePassphrase,
    setUnlockPassphrase,
    statusPill,
    storageState,
    storedVault,
    unlockPassphrase,
    walletAddress,
    wasmReady: wasmStatus === 'ready',
  }
}

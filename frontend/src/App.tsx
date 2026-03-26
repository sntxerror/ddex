import { Container, Paper, SimpleGrid, Stack, Text } from '@mantine/core'
import {
  accountKeyFromMnemonic,
  generateMnemonic,
  getAddressForAccount,
  initWalletCore,
  validateMnemonic,
  type WalletAccountKey,
} from '@ddex/wallet-core-web'
import { useEffect, useMemo, useState } from 'react'
import { HeroPanel, type HeroPanelNotice, type HeroPanelTone } from './components/HeroPanel'
import { ReceivePanel } from './components/ReceivePanel'
import {
  WalletSetupPanel,
  type WalletSetupMode,
} from './components/WalletSetupPanel'
import styles from './App.module.css'

const TESTNET_FOG_REPORT_URL = 'fog.test.mobilecoin.com'
const TESTNET_FOG_AUTHORITY_SPKI = new Uint8Array()

type WasmStatus = 'loading' | 'ready' | 'error'

function App() {
  const [wasmStatus, setWasmStatus] = useState<WasmStatus>('loading')
  const [wasmError, setWasmError] = useState('')
  const [mode, setMode] = useState<WalletSetupMode>('create')
  const [working, setWorking] = useState(false)
  const [mnemonicDraft, setMnemonicDraft] = useState('')
  const [walletMnemonic, setWalletMnemonic] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [walletAccount, setWalletAccount] = useState<WalletAccountKey | null>(null)
  const [feedback, setFeedback] = useState('')
  const [copiedState, setCopiedState] = useState<'mnemonic' | 'address' | null>(null)

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

  const deriveWallet = async (phrase: string) => {
    setWorking(true)
    setFeedback('')
    setWalletAddress('')
    setWalletAccount(null)

    try {
      const account = await accountKeyFromMnemonic(
        phrase,
        TESTNET_FOG_REPORT_URL,
        TESTNET_FOG_AUTHORITY_SPKI,
      )
      const address = await getAddressForAccount(account)
      setWalletMnemonic(phrase)
      setWalletAccount(account)
      setWalletAddress(address)
      setFeedback('Wallet material derived locally in the browser. No server saw the phrase.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFeedback(message)
    } finally {
      setWorking(false)
    }
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
        setCopiedState((current: 'mnemonic' | 'address' | null) => (current === type ? null : current))
      }, 1600)
    } catch {
      setFeedback('Clipboard access was denied. Old-school copy still works, promise.')
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

  return (
    <div className={styles.shell}>
      <Container className={styles.page} size="lg">
        <Stack gap="xl">
          <HeroPanel notice={notice} statusLabel={statusPill.label} statusTone={statusPill.tone} />

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
            <WalletSetupPanel
              copiedMnemonic={copiedState === 'mnemonic'}
              displayedMnemonic={displayedMnemonic}
              isDraftValid={isDraftValid}
              mnemonicDraft={mnemonicDraft}
              mode={mode}
              onCopyMnemonic={() => void handleCopy(displayedMnemonic, 'mnemonic')}
              onCreate={() => void handleCreate()}
              onDraftChange={setMnemonicDraft}
              onImport={() => void handleImport()}
              onModeChange={setMode}
              wasmReady={wasmStatus === 'ready'}
              wordCount={mnemonicWordCount}
              working={working}
            />

            <ReceivePanel
              copiedAddress={copiedState === 'address'}
              fogReportUrl={TESTNET_FOG_REPORT_URL}
              keyMaterialBytes={keyMaterialBytes}
              onCopyAddress={() => void handleCopy(walletAddress, 'address')}
              walletAddress={walletAddress}
            />
          </SimpleGrid>

          <Paper className={styles.footer} p="xl" radius="xl" withBorder>
            <Text c="dimmed" lh={1.7} size="sm">
              This is the first wallet-oriented frontend slice: it proves the regenerated package can
              initialize, generate or import mnemonics, derive an account key, and encode the default
              receive address without touching a server. Keystore persistence, unlock flows, Fog sync,
              and send reconciliation are the next stops on the roadmap.
            </Text>
          </Paper>
        </Stack>
      </Container>
    </div>
  )
}

export default App

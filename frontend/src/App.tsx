import {
  ActionIcon,
  Avatar,
  Badge,
  Burger,
  Button,
  Container,
  Divider,
  Drawer,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core'
import {
  accountKeyFromMnemonic,
  generateMnemonic,
  getAddressForAccount,
  initWalletCore,
  validateMnemonic,
  type WalletAccountKey,
} from '@ddex/wallet-core-web'
import { useDisclosure } from '@mantine/hooks'
import { useEffect, useMemo, useState } from 'react'
import {
  IconArrowRight,
  IconChartArrowsVertical,
  IconHome2,
  IconMapPin,
  IconMoonStars,
  IconSettings,
  IconShieldLock,
  IconSunHigh,
  IconWallet,
} from '@tabler/icons-react'
import { HeroPanel, type HeroPanelNotice, type HeroPanelTone } from './components/HeroPanel'
import { ReceivePanel } from './components/ReceivePanel'
import {
  SecureStoragePanel,
  type SecureStorageState,
} from './components/SecureStoragePanel'
import {
  WalletSetupPanel,
  type WalletSetupMode,
} from './components/WalletSetupPanel'
import {
  deleteStoredWalletKeystore,
  getStoredWalletKeystoreMetadata,
  isSecureKeystoreSupported,
  saveWalletKeystore,
  unlockStoredWalletMnemonic,
  type StoredWalletKeystoreMetadata,
} from './keystore/secureKeystore'
import styles from './App.module.css'

const TESTNET_FOG_REPORT_URL = 'fog.test.mobilecoin.com'
const TESTNET_FOG_AUTHORITY_SPKI = new Uint8Array()

type WasmStatus = 'loading' | 'ready' | 'error'
type AppView = 'overview' | 'address' | 'settings'

const navigationItems = [
  {
    description: 'Dashboard, wallet setup, and account pulse',
    icon: IconHome2,
    label: 'Home',
    value: 'overview',
  },
  {
    description: 'Your primary receive address and testnet details',
    icon: IconWallet,
    label: 'My wallet address',
    value: 'address',
  },
  {
    description: 'Manage the encrypted device vault and relock controls',
    icon: IconSettings,
    label: 'Settings',
    value: 'settings',
  },
] as const

function shortenAddress(address: string): string {
  if (address.length <= 22) {
    return address || 'Waiting for wallet setup'
  }

  return `${address.slice(0, 12)}…${address.slice(-10)}`
}

function App() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const [wasmStatus, setWasmStatus] = useState<WasmStatus>('loading')
  const [wasmError, setWasmError] = useState('')
  const [currentView, setCurrentView] = useState<AppView>('overview')
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
  const [mobileNavigationOpened, { close: closeMobileNavigation, toggle: toggleMobileNavigation }] =
    useDisclosure(false)

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
      const account = await accountKeyFromMnemonic(
        phrase,
        TESTNET_FOG_REPORT_URL,
        TESTNET_FOG_AUTHORITY_SPKI,
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
        setCopiedState((current: 'mnemonic' | 'address' | null) => (current === type ? null : current))
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
  const isDark = colorScheme === 'dark'

  const walletStateLabel = hasLoadedWallet ? 'Wallet active' : 'Setup needed'
  const vaultStateLabel = storageState === 'unsupported'
    ? 'Unsupported browser'
    : storedVault
      ? 'Vault saved'
      : storageState === 'error'
        ? 'Vault unavailable'
        : 'Not saved yet'

  const heroStats = [
    { label: 'Profile state', value: walletStateLabel },
    { label: 'Vault status', value: vaultStateLabel },
    { label: 'Network lane', value: 'MobileCoin testnet' },
  ] as const

  const accountPulse = [
    {
      description: hasLoadedWallet
        ? 'Mnemonic loaded in memory and ready for receive flows.'
        : 'Create or import a wallet to activate your profile.',
      label: 'Wallet session',
      value: walletStateLabel,
    },
    {
      description: storedVault
        ? 'Encrypted mnemonic is stored only on this browser profile.'
        : 'You can enable a local encrypted vault from Settings.',
      label: 'Device vault',
      value: vaultStateLabel,
    },
    {
      description: hasLoadedWallet
        ? shortenAddress(walletAddress)
        : 'No address derived yet',
      label: 'Primary address',
      value: hasLoadedWallet ? 'Ready to share' : 'Locked',
    },
    {
      description: 'Fog and consensus proxy routes are wired into the local dev stack.',
      label: 'Connectivity',
      value: 'Proxy online path',
    },
  ]

  const securityChecklist = [
    'Keep the recovery phrase offline and away from screenshots.',
    'Use a device-only vault passphrase that is distinct from exchange logins.',
    'Relock the in-memory wallet after testing on a shared machine.',
  ]

  const renderNavigationButton = (value: AppView, label: string) => {
    const active = currentView === value

    return (
      <UnstyledButton
        className={styles.navButton}
        data-active={active}
        onClick={() => {
          setCurrentView(value)
          closeMobileNavigation()
        }}
      >
        {label}
      </UnstyledButton>
    )
  }

  const heroAside = (
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
      working={isAnyWorkInFlight}
    />
  )

  const overviewContent = (
    <Stack gap="xl">
      <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="lg">
        {accountPulse.map((item) => (
          <Paper className={styles.summaryCard} key={item.label} p="lg" withBorder>
            <Stack gap="xs">
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                {item.label}
              </Text>
              <Text className={styles.summaryValue} fw={700} size="lg">
                {item.value}
              </Text>
              <Text c="dimmed" size="sm">
                {item.description}
              </Text>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
        <Paper className={styles.featureCard} p="xl" withBorder>
          <Stack gap="lg">
            <div>
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                Profile overview
              </Text>
              <Title mt="xs" order={2}>
                Your DDEX control center
              </Title>
              <Text c="dimmed" mt="sm" size="sm">
                This page is the friendly front door: set up a wallet, confirm your readiness, and
                jump into address sharing or vault management without digging through developer-ish
                panels.
              </Text>
            </div>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <Paper className={styles.miniCard} p="md" withBorder>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color="violet" radius="xl" size="lg" variant="light">
                    <IconWallet size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} size="sm">Wallet setup</Text>
                    <Text c="dimmed" size="xs">Local phrase generation or import</Text>
                  </div>
                </Group>
              </Paper>

              <Paper className={styles.miniCard} p="md" withBorder>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color="teal" radius="xl" size="lg" variant="light">
                    <IconChartArrowsVertical size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} size="sm">DEX readiness</Text>
                    <Text c="dimmed" size="xs">Proxy-backed path for network features</Text>
                  </div>
                </Group>
              </Paper>

              <Paper className={styles.miniCard} p="md" withBorder>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color="indigo" radius="xl" size="lg" variant="light">
                    <IconShieldLock size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} size="sm">Vault options</Text>
                    <Text c="dimmed" size="xs">Encrypted IndexedDB storage in Settings</Text>
                  </div>
                </Group>
              </Paper>
            </SimpleGrid>

            <Group gap="sm" wrap="wrap">
              <Button onClick={() => setCurrentView('address')} rightSection={<IconArrowRight size={16} />}>
                Open my wallet address
              </Button>
              <Button onClick={() => setCurrentView('settings')} variant="light">
                Open settings
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper className={styles.featureCard} p="xl" withBorder>
          <Stack gap="lg">
            <div>
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                Safety posture
              </Text>
              <Title mt="xs" order={2}>
                Noncustodial by design
              </Title>
              <Text c="dimmed" mt="sm" size="sm">
                DDEX keeps wallet operations local-first: mnemonic validation, address derivation,
                and device vault encryption all happen in the browser. In other words, your secrets
                don’t need a field trip.
              </Text>
            </div>

            <Stack gap="sm">
              {securityChecklist.map((item) => (
                <Group align="flex-start" gap="sm" key={item} wrap="nowrap">
                  <ThemeIcon color="indigo" radius="xl" size="md" variant="light">
                    <IconShieldLock size={14} />
                  </ThemeIcon>
                  <Text size="sm">{item}</Text>
                </Group>
              ))}
            </Stack>

            <Divider />

            <Group className={styles.inlineMeta} justify="space-between" wrap="wrap">
              <Group c="dimmed" gap="xs" wrap="nowrap">
                <IconMapPin size={16} />
                <Text size="sm">Fog route: {TESTNET_FOG_REPORT_URL}</Text>
              </Group>
              <Badge color="violet" variant="light">
                {keyMaterialBytes > 0 ? `${keyMaterialBytes} bytes in memory` : 'No keys in memory'}
              </Badge>
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  )

  const addressContent = (
    <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
      <ReceivePanel
        copiedAddress={copiedState === 'address'}
        fogReportUrl={TESTNET_FOG_REPORT_URL}
        keyMaterialBytes={keyMaterialBytes}
        onCopyAddress={() => void handleCopy(walletAddress, 'address')}
        walletAddress={walletAddress}
      />

      <Paper className={styles.featureCard} p="xl" withBorder>
        <Stack gap="lg">
          <div>
            <Text c="dimmed" fw={700} size="xs" tt="uppercase">
              Share with confidence
            </Text>
            <Title mt="xs" order={2}>
              Address screen for receiving funds
            </Title>
            <Text c="dimmed" mt="sm" size="sm">
              Keep this view handy when you need to receive testnet funds or verify that the active
              wallet profile is the one you expect.
            </Text>
          </div>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Paper className={styles.miniCard} p="md" withBorder>
              <Text c="dimmed" size="xs" tt="uppercase">Address preview</Text>
              <Text fw={700} mt="xs" size="sm">
                {hasLoadedWallet ? shortenAddress(walletAddress) : 'Wallet not loaded'}
              </Text>
            </Paper>

            <Paper className={styles.miniCard} p="md" withBorder>
              <Text c="dimmed" size="xs" tt="uppercase">Recommended next step</Text>
              <Text fw={700} mt="xs" size="sm">
                {storedVault ? 'Vault already configured' : 'Visit Settings to save a local vault'}
              </Text>
            </Paper>
          </SimpleGrid>

          <Text c="dimmed" size="sm">
            Coming next, this screen can evolve into QR presentation, account labeling, and receive
            history. For now it gives your default address a proper home instead of burying it under
            setup controls.
          </Text>
        </Stack>
      </Paper>
    </SimpleGrid>
  )

  const settingsContent = (
    <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
      <SecureStoragePanel
        hasLoadedWallet={hasLoadedWallet}
        onDeleteStoredWallet={() => void handleDeleteStoredWallet()}
        onRelockWallet={relockWallet}
        onSavePassphraseChange={setSavePassphrase}
        onSaveToDevice={() => void handleSaveToDevice()}
        onUnlockFromDevice={() => void handleUnlockFromDevice()}
        onUnlockPassphraseChange={setUnlockPassphrase}
        savePassphrase={savePassphrase}
        status={storageState}
        storedVault={storedVault}
        unlockPassphrase={unlockPassphrase}
        working={isAnyWorkInFlight}
      />

      <Paper className={styles.featureCard} p="xl" withBorder>
        <Stack gap="lg">
          <div>
            <Text c="dimmed" fw={700} size="xs" tt="uppercase">
              Settings guide
            </Text>
            <Title mt="xs" order={2}>
              Tune the local vault experience
            </Title>
            <Text c="dimmed" mt="sm" size="sm">
              Use Settings as the home for device trust decisions: save an encrypted vault, unlock it
              later, relock hot key material, or wipe the stored ciphertext from this browser.
            </Text>
          </div>

          <Stack gap="sm">
            {[
              'Save only after confirming the recovery phrase is backed up offline.',
              'Unlocking restores the mnemonic locally and immediately re-derives the wallet.',
              'Deleting the vault removes encrypted storage but does not affect offline backups.',
            ].map((item) => (
              <Group align="flex-start" gap="sm" key={item} wrap="nowrap">
                <ThemeIcon color="violet" radius="xl" size="md" variant="light">
                  <IconSettings size={14} />
                </ThemeIcon>
                <Text size="sm">{item}</Text>
              </Group>
            ))}
          </Stack>

          <Paper className={styles.miniCard} p="md" withBorder>
            <Text c="dimmed" size="xs" tt="uppercase">
              Current environment
            </Text>
            <Text fw={700} mt="xs" size="sm">
              {storageState === 'unsupported'
                ? 'Storage APIs unavailable in this browser'
                : 'IndexedDB + WebCrypto path detected'}
            </Text>
            <Text c="dimmed" mt="xs" size="sm">
              Vault metadata is visible only on this device and only after the local storage layer is
              opened successfully.
            </Text>
          </Paper>
        </Stack>
      </Paper>
    </SimpleGrid>
  )

  const currentViewContent = currentView === 'overview'
    ? overviewContent
    : currentView === 'address'
      ? addressContent
      : settingsContent

  return (
    <div className={styles.shell}>
      <Container className={styles.page} size="lg">
        <Stack gap="xl">
          <Paper className={styles.header} p="sm" radius="xl" shadow="sm" withBorder>
            <Group className={styles.headerInner} justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <Paper className={styles.brandMark} p="xs" radius="xl" withBorder>
                  <Text fw={900} size="sm">DDEX</Text>
                </Paper>
                <div>
                  <Text fw={700}>Decentralized exchange profile</Text>
                  <Text c="dimmed" size="sm">Wallet, address, and vault controls in one responsive shell</Text>
                </div>
              </Group>

              <Group className={styles.desktopNav} gap="xs" wrap="nowrap">
                {navigationItems.map((item) => renderNavigationButton(item.value, item.label))}
              </Group>

              <Group className={styles.headerActions} gap="xs" wrap="nowrap">
                <ActionIcon
                  aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                  onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
                  size="lg"
                >
                  {isDark ? <IconSunHigh size={18} /> : <IconMoonStars size={18} />}
                </ActionIcon>
                <Avatar color="violet" radius="xl" variant="light">DX</Avatar>
                <div className={styles.mobileOnly}>
                  <Burger
                    aria-label="Toggle navigation"
                    onClick={toggleMobileNavigation}
                    opened={mobileNavigationOpened}
                    size="sm"
                  />
                </div>
              </Group>
            </Group>
          </Paper>

          <Drawer
            opened={mobileNavigationOpened}
            onClose={closeMobileNavigation}
            padding="md"
            position="right"
            title="Navigate DDEX"
          >
            <Stack gap="sm">
              {navigationItems.map((item) => {
                const Icon = item.icon

                return (
                  <UnstyledButton
                    className={styles.drawerNavButton}
                    key={item.value}
                    onClick={() => {
                      setCurrentView(item.value)
                      closeMobileNavigation()
                    }}
                  >
                    <Group align="flex-start" gap="sm" wrap="nowrap">
                      <ThemeIcon color="violet" radius="xl" size="lg" variant="light">
                        <Icon size={18} />
                      </ThemeIcon>
                      <div>
                        <Text fw={700}>{item.label}</Text>
                        <Text c="dimmed" size="sm">{item.description}</Text>
                      </div>
                    </Group>
                  </UnstyledButton>
                )
              })}
            </Stack>
          </Drawer>

          <HeroPanel
            aside={heroAside}
            description="A mobile-first wallet profile for DDEX: create or import locally, keep addresses easy to reach, and manage encrypted device vault settings without leaving the dashboard flow."
            eyebrow="Profile dashboard"
            highlights={[
              'Client-only wallet setup',
              'Dedicated address screen',
              'Settings-based device vault',
            ]}
            notice={notice}
            stats={heroStats}
            statusLabel={statusPill.label}
            statusTone={statusPill.tone}
            title="Your DDEX wallet, cleaned up and ready to grow"
          />

          <Paper className={styles.viewIntro} p="xl" withBorder>
            <Group justify="space-between" wrap="wrap">
              <div>
                <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                  {navigationItems.find((item) => item.value === currentView)?.label}
                </Text>
                <Title mt="xs" order={2}>
                  {currentView === 'overview'
                    ? 'Profile overview'
                    : currentView === 'address'
                      ? 'My wallet address'
                      : 'Settings'}
                </Title>
                <Text c="dimmed" mt="sm" size="sm">
                  {navigationItems.find((item) => item.value === currentView)?.description}
                </Text>
              </div>

              <Group gap="sm" wrap="wrap">
                <Badge color="teal" variant="light">
                  {hasLoadedWallet ? 'Wallet live in session' : 'Wallet not yet loaded'}
                </Badge>
                <Badge color="violet" variant="light">
                  {storedVault ? 'Vault configured' : 'Vault not configured'}
                </Badge>
              </Group>
            </Group>
          </Paper>

          {currentViewContent}

          <Paper className={styles.footer} p="xl" radius="xl" withBorder>
            <Text c="dimmed" lh={1.7} size="sm">
              DDEX now reads more like a product surface than a component test bench: wallet setup sits
              in the hero, the address has its own home, and vault controls live under Settings. Under
              the hood, it still runs the same local derivation and encrypted IndexedDB persistence you
              already validated. Next up: real Fog sync, send flows, and richer account activity.
            </Text>
          </Paper>
        </Stack>
      </Container>
    </div>
  )
}

export default App

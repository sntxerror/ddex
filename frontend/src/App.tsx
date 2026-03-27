import {
  Container,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useState } from 'react'
import {
  IconHome2,
  IconSettings,
  IconWallet,
} from '@tabler/icons-react'
import { AddressDetailsPanel } from './components/AddressDetailsPanel'
import { AppHeader } from './components/AppHeader'
import { HeroPanel } from './components/HeroPanel'
import { OverviewPanel } from './components/OverviewPanel'
import { ReceivePanel } from './components/ReceivePanel'
import { SecureStoragePanel } from './components/SecureStoragePanel'
import { SettingsGuidePanel } from './components/SettingsGuidePanel'
import { ViewIntro } from './components/ViewIntro'
import { WalletSetupPanel } from './components/WalletSetupPanel'
import { useWalletDashboard } from './hooks/useWalletDashboard'
import type { AppNavigationItem, AppView } from './types/appShell'
import styles from './App.module.css'

const TESTNET_FOG_REPORT_URL = 'fog.test.mobilecoin.com'

const navigationItems: readonly AppNavigationItem[] = [
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
  const [currentView, setCurrentView] = useState<AppView>('overview')
  const [mobileNavigationOpened, { close: closeMobileNavigation, toggle: toggleMobileNavigation }] =
    useDisclosure(false)
  const {
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
    wasmReady,
  } = useWalletDashboard({ fogReportUrl: TESTNET_FOG_REPORT_URL })
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
  ] as const

  const handleNavigate = (view: AppView) => {
    setCurrentView(view)
    closeMobileNavigation()
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
      wasmReady={wasmReady}
      wordCount={mnemonicWordCount}
      working={isAnyWorkInFlight}
    />
  )

  const overviewContent = (
    <OverviewPanel
      fogReportUrl={TESTNET_FOG_REPORT_URL}
      keyMaterialBytes={keyMaterialBytes}
      onOpenAddress={() => setCurrentView('address')}
      onOpenSettings={() => setCurrentView('settings')}
      securityChecklist={securityChecklist}
      summaryItems={accountPulse}
    />
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

      <AddressDetailsPanel
        hasLoadedWallet={hasLoadedWallet}
        shortenedAddress={shortenAddress(walletAddress)}
        storedVaultConfigured={storedVault !== null}
      />
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

      <SettingsGuidePanel storageState={storageState} />
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
          <AppHeader
            currentView={currentView}
            isDark={isDark}
            mobileNavigationOpened={mobileNavigationOpened}
            navigationItems={navigationItems}
            onCloseMobileNavigation={closeMobileNavigation}
            onNavigate={handleNavigate}
            onToggleColorScheme={() => setColorScheme(isDark ? 'light' : 'dark')}
            onToggleMobileNavigation={toggleMobileNavigation}
          />

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

          <ViewIntro
            currentView={currentView}
            hasLoadedWallet={hasLoadedWallet}
            navigationItems={navigationItems}
            storedVaultConfigured={storedVault !== null}
          />

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

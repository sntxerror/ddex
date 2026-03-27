import { ActionIcon, AppShell, Badge, Group, Stack, Text, useMantineColorScheme } from '@mantine/core'
import { IconLock, IconLockOpen2, IconMoonStars, IconSunHigh, IconWifi, IconWifiOff } from '@tabler/icons-react'
import { Outlet, useNavigate } from 'react-router'
import { BottomTabBar } from '../components/BottomTabBar/BottomTabBar'
import { WarningBanner } from '../components/WarningBanner/WarningBanner'
import { useSecurityScore } from '../hooks/useSecurityScore'
import { useNetworkStore } from '../stores/networkStore'
import { useKeystoreStore } from '../stores/keystoreStore'
import { getNextIncompleteOnboardingPath, useOnboardingStore } from '../stores/onboardingStore'
import { useWalletStore } from '../stores/walletStore'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const navigate = useNavigate()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const network = useNetworkStore((state) => state.network)
  const syncStatus = useNetworkStore((state) => state.syncStatus)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const walletAddress = useWalletStore((state) => state.address)
  const score = useSecurityScore()
  const nextIncompleteOnboardingPath = useOnboardingStore(getNextIncompleteOnboardingPath)
  const isDark = colorScheme === 'dark'
  const vaultLocked = walletAddress.length === 0
  const isDisconnected = syncStatus === 'offline'
  const networkBadgeColor = isDisconnected ? 'red' : network === 'mainnet' ? 'green' : 'yellow'
  const networkBadgeLabel = isDisconnected ? 'disconnected' : network

  return (
    <AppShell className={styles.shell} footer={{ height: 84 }} header={{ height: 68 }} padding={0}>
      <AppShell.Header className={styles.header}>
        <Group className={styles.frame} h="100%" justify="space-between" px="md">
          <Stack gap={0}>
            <Group gap="xs">
              <Text fw={700} size="sm" tt="uppercase">DDEX</Text>
            </Group>
            <Text c="dimmed" size="xs">Private payments. Decentralized exchange.</Text>
          </Stack>

          <Group gap="xs">
            
            <Badge
              color={networkBadgeColor}
              leftSection={isDisconnected ? <IconWifiOff size={12} /> : <IconWifi size={12} />}
              radius="xl"
              variant="light"
            >
              {networkBadgeLabel}
            </Badge>
            <Badge
              color={vaultLocked ? 'cyan' : storedVault ? 'yellow' : 'red'}
              leftSection={vaultLocked ? <IconLock size={12} /> : <IconLockOpen2 size={12} />}
              radius="xl"
              variant="light"
            >
              {vaultLocked ? 'locked' : storedVault ? 'unlocked · saved' : 'unlocked · unsaved'}
            </Badge>
            <ActionIcon
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
              radius="xl"
              size="lg"
              variant="default"
            >
              {isDark ? <IconSunHigh size={18} /> : <IconMoonStars size={18} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main className={styles.main}>
        <div className={styles.frame}>
          <Stack gap="lg">
            <WarningBanner
              items={score.pending}
              actionLabel={nextIncompleteOnboardingPath ? 'Continue Security Setup' : undefined}
              onAction={nextIncompleteOnboardingPath ? () => navigate(nextIncompleteOnboardingPath) : undefined}
            />
            <Outlet />
          </Stack>
        </div>
      </AppShell.Main>

      <AppShell.Footer className={styles.footer}>
        <div className={styles.frame}>
          <BottomTabBar />
        </div>
      </AppShell.Footer>
    </AppShell>
  )
}
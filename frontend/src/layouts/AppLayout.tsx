import { ActionIcon, AppShell, Badge, Group, Stack, Text, useMantineColorScheme } from '@mantine/core'
import { IconLock, IconLockOpen2, IconMoonStars, IconSunHigh, IconWifi } from '@tabler/icons-react'
import { Outlet } from 'react-router'
import { BottomTabBar } from '../components/BottomTabBar/BottomTabBar'
import { useNetworkStore } from '../stores/networkStore'
import { useKeystoreStore } from '../stores/keystoreStore'
import { useWalletStore } from '../stores/walletStore'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const network = useNetworkStore((state) => state.network)
  const syncStatus = useNetworkStore((state) => state.syncStatus)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const walletAddress = useWalletStore((state) => state.address)
  const isDark = colorScheme === 'dark'
  const vaultLocked = walletAddress.length === 0

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
            
            <Badge color={syncStatus === 'active' ? 'teal' : 'gray'} leftSection={<IconWifi size={12} />} radius="xl" variant="light">
              {network}
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
          <Outlet />
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
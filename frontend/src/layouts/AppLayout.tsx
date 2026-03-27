import { AppShell, Badge, Group, Stack, Text } from '@mantine/core'
import { IconLockOpen2, IconShieldCheckFilled, IconWifi } from '@tabler/icons-react'
import { Outlet } from 'react-router'
import { BottomTabBar } from '../components/BottomTabBar/BottomTabBar'
import { useNetworkStore } from '../stores/networkStore'
import { useKeystoreStore } from '../stores/keystoreStore'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const network = useNetworkStore((state) => state.network)
  const syncStatus = useNetworkStore((state) => state.syncStatus)
  const storedVault = useKeystoreStore((state) => state.storedVault)

  return (
    <AppShell className={styles.shell} footer={{ height: 84 }} header={{ height: 68 }} padding={0}>
      <AppShell.Header className={styles.header}>
        <Group className={styles.frame} h="100%" justify="space-between" px="md">
          <Stack gap={0}>
            <Group gap="xs">
              <IconShieldCheckFilled color="var(--ddex-accent-primary)" size={18} />
              <Text fw={700} size="sm" tt="uppercase">DDEX Vault</Text>
            </Group>
            <Text c="dimmed" size="xs">Private payments. Decentralized exchange.</Text>
          </Stack>

          <Group gap="xs">
            <Badge color={syncStatus === 'active' ? 'teal' : 'gray'} leftSection={<IconWifi size={12} />} radius="xl" variant="light">
              {network}
            </Badge>
            <Badge color={storedVault ? 'cyan' : 'gray'} leftSection={<IconLockOpen2 size={12} />} radius="xl" variant="light">
              {storedVault ? 'vault saved' : 'memory only'}
            </Badge>
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
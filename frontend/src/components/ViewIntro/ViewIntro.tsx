import { Badge, Group, Paper, Text, Title } from '@mantine/core'
import styles from './ViewIntro.module.css'
import type { ViewIntroProps } from './ViewIntro.types'

const viewTitles = {
  address: 'My wallet address',
  overview: 'Profile overview',
  settings: 'Settings',
} as const

export function ViewIntro({
  currentView,
  hasLoadedWallet,
  navigationItems,
  storedVaultConfigured,
}: ViewIntroProps) {
  const activeItem = navigationItems.find((item) => item.value === currentView)

  return (
    <Paper className={styles.panel} p="xl" withBorder>
      <Group justify="space-between" wrap="wrap">
        <div>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            {activeItem?.label}
          </Text>
          <Title mt="xs" order={2}>
            {viewTitles[currentView]}
          </Title>
          <Text c="dimmed" mt="sm" size="sm">
            {activeItem?.description}
          </Text>
        </div>

        <Group gap="sm" wrap="wrap">
          <Badge color="teal" variant="light">
            {hasLoadedWallet ? 'Wallet live in session' : 'Wallet not yet loaded'}
          </Badge>
          <Badge color="violet" variant="light">
            {storedVaultConfigured ? 'Vault configured' : 'Vault not configured'}
          </Badge>
        </Group>
      </Group>
    </Paper>
  )
}

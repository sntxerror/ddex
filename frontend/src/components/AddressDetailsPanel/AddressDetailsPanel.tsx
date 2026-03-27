import { Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import styles from './AddressDetailsPanel.module.css'
import type { AddressDetailsPanelProps } from './AddressDetailsPanel.types'

export function AddressDetailsPanel({
  hasLoadedWallet,
  shortenedAddress,
  storedVaultConfigured,
}: AddressDetailsPanelProps) {
  return (
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
              {hasLoadedWallet ? shortenedAddress : 'Wallet not loaded'}
            </Text>
          </Paper>

          <Paper className={styles.miniCard} p="md" withBorder>
            <Text c="dimmed" size="xs" tt="uppercase">Recommended next step</Text>
            <Text fw={700} mt="xs" size="sm">
              {storedVaultConfigured ? 'Vault already configured' : 'Visit Settings to save a local vault'}
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
  )
}

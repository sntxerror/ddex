import { Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconCopy, IconMapPin } from '@tabler/icons-react'
import styles from './ReceivePanel.module.css'
import type { ReceivePanelProps } from './ReceivePanel.types'

export function ReceivePanel({
  copiedAddress,
  fogReportUrl,
  keyMaterialBytes,
  onCopyAddress,
  walletAddress,
}: ReceivePanelProps) {
  const hasAddress = walletAddress.length > 0

  return (
    <Paper className={styles.panel} p="xl" radius="xl" shadow="sm" withBorder>
      <Stack gap="lg">
        <div>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            Receive
          </Text>
          <Title mt="xs" order={2}>
            Primary address
          </Title>
          <Text c="dimmed" mt="xs" size="sm">
            Once a mnemonic is derived, the default subaddress is encoded with the wallet-core WASM
            package.
          </Text>
        </div>

        <Paper className={styles.addressCard} p="md" radius="lg" withBorder>
          <Text className={styles.addressValue} component="code" size="sm">
            {hasAddress ? (
              walletAddress
            ) : (
              <span className={styles.addressPlaceholder}>
                Generate or import a mnemonic to populate the default b58 address.
              </span>
            )}
          </Text>
        </Paper>

        <Group justify="space-between" wrap="wrap">
          <Button
            disabled={!hasAddress}
            leftSection={<IconCopy size={16} />}
            onClick={onCopyAddress}
            variant="light"
          >
            {copiedAddress ? 'Copied' : 'Copy address'}
          </Button>
          <Group c="dimmed" gap="xs" wrap="nowrap">
            <IconMapPin size={16} />
            <Text size="sm">Testnet-first bootstrap</Text>
          </Group>
        </Group>

        <SimpleGrid className={styles.factsGrid} cols={{ base: 1, sm: 3 }} spacing="sm">
          <Paper className={styles.factCard} p="md" radius="lg" withBorder>
            <Text c="dimmed" size="xs" tt="uppercase">
              Network
            </Text>
            <Text fw={600} mt="xs" size="sm">
              MobileCoin testnet
            </Text>
          </Paper>

          <Paper className={styles.factCard} p="md" radius="lg" withBorder>
            <Text c="dimmed" size="xs" tt="uppercase">
              Fog report URL
            </Text>
            <Text fw={600} mt="xs" size="sm">
              {fogReportUrl}
            </Text>
          </Paper>

          <Paper className={styles.factCard} p="md" radius="lg" withBorder>
            <Text c="dimmed" size="xs" tt="uppercase">
              Key material in memory
            </Text>
            <Text fw={600} mt="xs" size="sm">
              {keyMaterialBytes > 0 ? `${keyMaterialBytes} bytes loaded` : 'None loaded yet'}
            </Text>
          </Paper>
        </SimpleGrid>
      </Stack>
    </Paper>
  )
}

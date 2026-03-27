import { ActionIcon, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core'
import { IconCopy, IconQrcode } from '@tabler/icons-react'
import { MOCK_BALANCE_MOB } from '../../config'
import { useTransferStore } from '../../stores/transferStore'
import { useUiStore } from '../../stores/uiStore'

export function TransferScreen() {
  const amount = useTransferStore((state) => state.amount)
  const recipient = useTransferStore((state) => state.recipient)
  const setAmount = useTransferStore((state) => state.setAmount)
  const setRecipient = useTransferStore((state) => state.setRecipient)
  const amountsHidden = useUiStore((state) => state.amountsHidden)

  const pasteFromClipboard = async () => {
    try {
      const clipboardValue = await navigator.clipboard.readText()
      setRecipient(clipboardValue)
    } catch {
      // Best effort only.
    }
  }

  return (
    <Stack gap="lg">
      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={700}>Amount to Send</Text>
            <Button onClick={() => setAmount(MOCK_BALANCE_MOB.toFixed(2))} radius="xl" size="xs" variant="subtle">ALL</Button>
          </Group>
          <TextInput onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00 MOB" radius="xl" value={amount} />
          <Text c="dimmed" size="sm">Available: {amountsHidden ? '***.** MOB' : `${MOCK_BALANCE_MOB.toFixed(2)} MOB`}</Text>
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="sm">
          <Text fw={700}>Receiver Address</Text>
          <TextInput
            onChange={(event) => setRecipient(event.currentTarget.value)}
            placeholder="Paste or scan a MobileCoin address"
            radius="xl"
            rightSection={
              <Group gap={4} mr={6} wrap="nowrap">
                <ActionIcon aria-label="Paste address" onClick={() => void pasteFromClipboard()} radius="xl" size="sm" variant="subtle">
                  <IconCopy size={16} />
                </ActionIcon>
                <ActionIcon aria-label="Scan QR" disabled radius="xl" size="sm" variant="subtle">
                  <IconQrcode size={16} />
                </ActionIcon>
              </Group>
            }
            value={recipient}
          />
        </Stack>
      </Paper>

      <Button disabled gradient={{ from: 'cyan', to: 'teal', deg: 135 }} radius="xl" size="lg" variant="gradient">
        Send MOB →
      </Button>
    </Stack>
  )
}
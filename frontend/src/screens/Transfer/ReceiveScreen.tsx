import { Button, Code, Group, Paper, Stack, Text } from '@mantine/core'
import { QRCodeSVG } from 'qrcode.react'
import { useWalletStore } from '../../stores/walletStore'

export function ReceiveScreen() {
  const address = useWalletStore((state) => state.address)

  const copy = async () => {
    if (!address) {
      return
    }

    try {
      await navigator.clipboard.writeText(address)
    } catch {
      // Best effort only.
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Receive MOB</Text>
        <Text c="dimmed">Use this QR code or full address to receive deposits into your vault.</Text>
      </Stack>

      <Paper p="xl" radius="xl" ta="center" withBorder>
        <QRCodeSVG bgColor="transparent" fgColor="currentColor" includeMargin size={220} style={{ color: 'var(--ddex-text-primary)' }} value={address || 'ddex'} />
      </Paper>

      <Code block>{address}</Code>
      <Group grow>
        <Button onClick={() => void copy()} radius="xl" variant="default">Copy Address</Button>
        <Button disabled radius="xl" variant="light">Share</Button>
      </Group>
    </Stack>
  )
}
import { ActionIcon, Avatar, Badge, Code, Group, Paper, Stack, Text } from '@mantine/core'
import { IconCopy, IconShieldCheck } from '@tabler/icons-react'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router'
import { useSecurityScore } from '../../hooks/useSecurityScore'
import { createWalletAlias, formatAddress } from '../../types/wallet'
import { useWalletStore } from '../../stores/walletStore'

export function ProfileScreen() {
  const navigate = useNavigate()
  const address = useWalletStore((state) => state.address)
  const score = useSecurityScore()
  const alias = createWalletAlias(address)
  const scoreBadgeColor = score.pending.length === 0 ? 'teal' : score.achieved >= 6 ? 'cyan' : score.achieved >= 3 ? 'yellow' : 'red'
  const addressDisplay = formatAddress(address)

  const copyAddress = async () => {
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
      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Group align="center" justify="space-between">
            <Group>
              <Avatar color="cyan" radius="xl" size={56}>{alias.slice(0, 2).toUpperCase()}</Avatar>
              <Stack gap={2}>
                <Group gap="xs">
                  <Text fw={800}>{alias}</Text>
                  <Badge
                    color={scoreBadgeColor}
                    leftSection={<IconShieldCheck size={14} />}
                    onClick={() => navigate('/settings')}
                    radius="xl"
                    style={{ cursor: 'pointer' }}
                    variant="light"
                  >
                    {score.achieved.toFixed(1)}/10
                  </Badge>
                </Group>
                <Text c="dimmed" size="sm">ID: APX-9921-X</Text>
              </Stack>
            </Group>
          </Group>

          <Paper p="md" radius="lg" withBorder>
            <Stack align="center" gap="sm">
              <Text fw={700}>Deposit Address</Text>
              <QRCodeSVG bgColor="transparent" fgColor="currentColor" includeMargin size={132} style={{ color: 'var(--ddex-text-primary)' }} value={address || 'ddex'} />
              <Group align="center" gap="xs" wrap="nowrap">
                <Code block>{addressDisplay}</Code>
                <ActionIcon aria-label="Copy wallet address" onClick={() => void copyAddress()} radius="xl" variant="default">
                  <IconCopy size={16} />
                </ActionIcon>
              </Group>
            </Stack>
          </Paper>
        </Stack>
      </Paper>
    </Stack>
  )
}
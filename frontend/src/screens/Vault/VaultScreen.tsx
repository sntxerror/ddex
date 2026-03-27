import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconEye, IconEyeOff, IconWaveSquare } from '@tabler/icons-react'
import { MOCK_BALANCE_MOB } from '../../config'
import { QuickActions } from '../../components/QuickActions/QuickActions'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/uiStore'

const activity = [
  { amount: '+12.00 MOB', badge: 'CONFIDENTIAL', title: 'Fog-Masked Receive', when: '2m ago' },
  { amount: '-4.50 MOB', badge: 'VERIFIED', title: 'Outbound Transfer', when: '19m ago' },
  { amount: '+1.28 MOB', badge: 'CONFIDENTIAL', title: 'Inbound Settlement', when: 'Yesterday' },
  { amount: '-0.72 MOB', badge: 'VERIFIED', title: 'Fee Settlement', when: '2d ago' },
  { amount: '+8.16 MOB', badge: 'CONFIDENTIAL', title: 'Private Receive', when: '4d ago' },
] as const

export function VaultScreen() {
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const lastUnlockAt = useKeystoreStore((state) => state.lastUnlockAt)
  const sessionDurationMs = useKeystoreStore((state) => state.sessionDurationMs)
  const amountsHidden = useUiStore((state) => state.amountsHidden)
  const toggleAmountsHidden = useUiStore((state) => state.toggleAmountsHidden)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 30_000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  const remainingMinutes = lastUnlockAt
    ? Math.max(0, Math.round((lastUnlockAt + sessionDurationMs - now) / 60_000))
    : null
  const visibleActivity = activity.slice(0, 3)
  const balanceText = amountsHidden ? '***.** MOB' : `${MOCK_BALANCE_MOB.toFixed(2)} MOB`
  const formatActivityAmount = (amount: string) => (amountsHidden ? '***.** MOB' : amount)

  return (
    <Stack gap="lg">
      <Paper p="xl" radius="xl" withBorder>
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap">
            <Text c="dimmed" size="sm" tt="uppercase">Total balance</Text>
            <ActionIcon
              aria-label={amountsHidden ? 'Show balances and transaction amounts' : 'Hide balances and transaction amounts'}
              onClick={toggleAmountsHidden}
              radius="xl"
              variant="default"
            >
              {amountsHidden ? <IconEye size={16} /> : <IconEyeOff size={16} />}
            </ActionIcon>
          </Group>
          <Text fw={900} size="3rem">{balanceText}</Text>
          <Text c="dimmed" size="sm">
            {remainingMinutes !== null ? `Session valid for ${remainingMinutes}m.` : 'Session active in memory.'} {storedVault ? 'Encrypted wallet is stored on this device.' : 'Wallet is currently memory-only until PIN lock is saved.'}
          </Text>
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Text fw={700}>Quick Actions</Text>
          <QuickActions />
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={700}>Transaction History</Text>
            <ThemeIcon color="teal" radius="xl" variant="light"><IconWaveSquare size={18} /></ThemeIcon>
          </Group>
          {visibleActivity.map((entry) => (
            <Group justify="space-between" key={`${entry.title}-${entry.when}`}>
              <Stack gap={2}>
                <Text fw={600}>{entry.title}</Text>
                <Text c="dimmed" size="sm">{entry.when}</Text>
              </Stack>
              <Stack align="flex-end" gap={2}>
                <Text fw={700}>{formatActivityAmount(entry.amount)}</Text>
                <Badge color="gray" radius="xl" variant="light">{entry.badge}</Badge>
              </Stack>
            </Group>
          ))}
          <Button disabled radius="xl" variant="subtle">Show all (coming soon)</Button>
        </Stack>
      </Paper>

      
    </Stack>
  )
}
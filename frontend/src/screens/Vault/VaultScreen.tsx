import { Badge, Button, Grid, Group, Paper, PasswordInput, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconCircleCheckFilled, IconLockOpen2, IconShieldCheck, IconWaveSquare } from '@tabler/icons-react'
import { MOCK_BALANCE_MOB, MOCK_BALANCE_USD } from '../../config'
import { QuickActions } from '../../components/QuickActions/QuickActions'
import { SecurityScoreCard } from '../../components/SecurityScoreCard/SecurityScoreCard'
import { WarningBanner } from '../../components/WarningBanner/WarningBanner'
import { useSecurityScore } from '../../hooks/useSecurityScore'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useWalletStore } from '../../stores/walletStore'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

const activity = [
  { amount: '+12.00 MOB', badge: 'CONFIDENTIAL', title: 'Fog-Masked Receive', when: '2m ago' },
  { amount: '-4.50 MOB', badge: 'VERIFIED', title: 'Outbound Transfer', when: '19m ago' },
  { amount: '+1.28 MOB', badge: 'CONFIDENTIAL', title: 'Inbound Settlement', when: 'Yesterday' },
] as const

export function VaultScreen() {
  const navigate = useNavigate()
  const feedback = useWalletStore((state) => state.feedback)
  const saveVault = useKeystoreStore((state) => state.saveVault)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const working = useKeystoreStore((state) => state.working)
  const lastUnlockAt = useKeystoreStore((state) => state.lastUnlockAt)
  const sessionDurationMs = useKeystoreStore((state) => state.sessionDurationMs)
  const score = useSecurityScore()
  const [newPassphrase, setNewPassphrase] = useState('')
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

  return (
    <Stack gap="lg">
      <Paper p="xl" radius="xl" withBorder>
        <Stack gap="md">
          <Text c="dimmed" size="sm" tt="uppercase">Total balance</Text>
          <Text fw={900} size="3rem">{MOCK_BALANCE_MOB.toFixed(2)} MOB</Text>
          <Text c="dimmed">{MOCK_BALANCE_USD} USD estimate</Text>
        </Stack>
      </Paper>

      <WarningBanner items={score.pending} />

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper h="100%" p="lg" radius="xl" withBorder>
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={700}>Network status</Text>
                <Badge color="teal" leftSection={<IconCircleCheckFilled size={12} />} radius="xl" variant="light">ACTIVE</Badge>
              </Group>
              <Text>Connected via Fog Proxy</Text>
              <Text c="dimmed" size="sm">The routed shell is in place; live balance sync is the next phase.</Text>
            </Stack>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper h="100%" p="lg" radius="xl" withBorder>
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={700}>Wallet status</Text>
                <Badge color="cyan" leftSection={<IconLockOpen2 size={12} />} radius="xl" variant="light">UNLOCKED</Badge>
              </Group>
              <Text>{remainingMinutes !== null ? `Session valid for ${remainingMinutes}m` : 'Session active in memory'}</Text>
              <Text c="dimmed" size="sm">{storedVault ? 'Stored vault detected with auto-lock timer running.' : 'In-memory wallet only; save a passphrase to enable device unlock.'}</Text>
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>

      <SecurityScoreCard />

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={700}>Wallet Security</Text>
            <ThemeIcon color="cyan" radius="xl" variant="light"><IconShieldCheck size={18} /></ThemeIcon>
          </Group>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveVault(newPassphrase)
            }}
          >
            <Stack gap="md">
              <PasswordInput
                autoComplete="new-password"
                name="updated-device-passphrase"
                onChange={(event) => setNewPassphrase(event.currentTarget.value)}
                placeholder="Update local passphrase"
                radius="xl"
                value={newPassphrase}
              />
              <Group grow>
                <Button onClick={() => navigate('/profile/recovery-phrase')} radius="xl" type="button" variant="default">Recovery Phrase</Button>
                <Button disabled={!newPassphrase.trim() || working} gradient={{ from: 'cyan', to: 'teal', deg: 135 }} radius="xl" type="submit" variant="gradient">
                  Secure Vault
                </Button>
              </Group>
            </Stack>
          </form>
          {feedback ? <Text c="dimmed" size="sm">{feedback}</Text> : null}
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
            <Text fw={700}>Privacy Log</Text>
            <ThemeIcon color="teal" radius="xl" variant="light"><IconWaveSquare size={18} /></ThemeIcon>
          </Group>
          {activity.map((entry) => (
            <Group justify="space-between" key={`${entry.title}-${entry.when}`}>
              <Stack gap={2}>
                <Text fw={600}>{entry.title}</Text>
                <Text c="dimmed" size="sm">{entry.when}</Text>
              </Stack>
              <Stack align="flex-end" gap={2}>
                <Text fw={700}>{entry.amount}</Text>
                <Badge color="gray" radius="xl" variant="light">{entry.badge}</Badge>
              </Stack>
            </Group>
          ))}
        </Stack>
      </Paper>
    </Stack>
  )
}
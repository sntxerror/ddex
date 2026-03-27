import { Avatar, Badge, Button, Code, Grid, Group, Paper, Stack, Switch, Text } from '@mantine/core'
import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router'
import { SecurityScoreCard } from '../../components/SecurityScoreCard/SecurityScoreCard'
import { createWalletAlias, formatAddress } from '../../types/wallet'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useWalletStore } from '../../stores/walletStore'

export function ProfileScreen() {
  const navigate = useNavigate()
  const address = useWalletStore((state) => state.address)
  const feedback = useWalletStore((state) => state.feedback)
  const lockSession = useKeystoreStore((state) => state.lockSession)
  const deleteVault = useKeystoreStore((state) => state.deleteVault)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const [stealthMode, setStealthMode] = useState(true)
  const [biometricUnlock, setBiometricUnlock] = useState(false)
  const alias = createWalletAlias(address)

  return (
    <Stack gap="lg">
      <Paper p="lg" radius="xl" withBorder>
        <Group align="center" justify="space-between">
          <Group>
            <Avatar color="cyan" radius="xl" size={56}>{alias.slice(0, 2).toUpperCase()}</Avatar>
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={800}>{alias}</Text>
                <Badge color="cyan" radius="xl" variant="light">Tier 01</Badge>
              </Group>
              <Text c="dimmed" size="sm">ID: APX-9921-X</Text>
            </Stack>
          </Group>
          <Button disabled={!storedVault} onClick={() => lockSession('Wallet locked from profile settings.')} radius="xl" variant="default">
            {storedVault ? 'Lock All' : 'Lock unavailable'}
          </Button>
        </Group>
        {!storedVault ? <Text c="dimmed" mt="sm" size="sm">Save a local passphrase first. Locking an in-memory-only wallet would otherwise remove access completely.</Text> : null}
        {feedback ? <Text c="dimmed" mt="sm" size="sm">{feedback}</Text> : null}
      </Paper>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <SecurityScoreCard compact />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper h="100%" p="lg" radius="xl" withBorder>
            <Stack align="center" gap="sm">
              <Text fw={700}>Deposit Address</Text>
              <QRCodeSVG bgColor="transparent" fgColor="#f1f5f9" includeMargin size={148} value={address || 'ddex'} />
              <Code block>{formatAddress(address)}</Code>
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Text fw={700}>Quick Links</Text>
          <Group grow>
            <Button disabled radius="xl" variant="default">View History</Button>
            <Button onClick={() => navigate('/profile/network')} radius="xl" variant="default">Network Settings</Button>
          </Group>
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Text fw={700}>Privacy & Security</Text>
          <Group justify="space-between">
            <Stack gap={2}><Text fw={600}>Stealth Mode</Text><Text c="dimmed" size="sm">Reduce shoulder-surfing cues in shared spaces.</Text></Stack>
            <Switch checked={stealthMode} color="teal" onChange={(event) => setStealthMode(event.currentTarget.checked)} />
          </Group>
          <Group justify="space-between">
            <Stack gap={2}><Text fw={600}>Biometric Unlock</Text><Text c="dimmed" size="sm">Placeholder toggle until WebAuthn lands.</Text></Stack>
            <Switch checked={biometricUnlock} color="teal" onChange={(event) => setBiometricUnlock(event.currentTarget.checked)} />
          </Group>
          <Button onClick={() => navigate('/profile/recovery-phrase')} radius="xl" variant="default">Recovery Phrase →</Button>
          <Button disabled radius="xl" variant="default">Multi-Sig Approval →</Button>
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Text c="red.3" fw={700}>Deactivate Vault</Text>
          <Text c="dimmed" size="sm">Wipe all local data and lock private keys on this device.</Text>
          <Button color="red" onClick={() => void deleteVault()} radius="xl" variant={storedVault ? 'filled' : 'light'}>
            Delete Local Vault
          </Button>
        </Stack>
      </Paper>
    </Stack>
  )
}
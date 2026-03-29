import { Alert, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconBolt, IconFingerprint } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { FeatureCard } from '../../components/FeatureCard/FeatureCard'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useOnboardingStore } from '../../stores/onboardingStore'

export function WelcomeScreen() {
  const navigate = useNavigate()
  const walletPrepared = useOnboardingStore((state) => state.walletPrepared)
  const reset = useOnboardingStore((state) => state.reset)
  const storedVault = useKeystoreStore((state) => state.storedVault)

  // walletPrepared + no vault + arriving at /welcome means sessionStorage was
  // empty (tab was closed) — the temp mnemonic is gone.
  const sessionExpired = walletPrepared && !storedVault

  if (sessionExpired) {
    return (
      <Stack gap="xl">
        <Stack gap="sm">
          <Text c="cyan.3" fw={700} size="sm" tt="uppercase">Previous session expired</Text>
          <Text fw={900} lh={1.05} size="2.5rem">Your wallet session has ended.</Text>
        </Stack>

        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} radius="xl" variant="light">
          Your temporary wallet was lost when the tab was closed. The recovery phrase was only kept in memory and was never secured with a PIN. If you wrote down your recovery phrase, you can restore your wallet below.
        </Alert>

        <Stack gap="sm">
          <Button gradient={{ from: 'cyan', to: 'teal', deg: 135 }} onClick={() => { reset(); navigate('/onboard/create') }} radius="xl" size="lg" variant="gradient">
            Create New Wallet
          </Button>
          <Button onClick={() => navigate('/onboard/import')} radius="xl" size="lg" variant="default">
            Recover from Phrase
          </Button>
        </Stack>

        <Text c="dimmed" size="sm">
          Next time, set a PIN during setup — your wallet will then survive both refreshes and tab closes.
        </Text>
      </Stack>
    )
  }

  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <Text c="cyan.3" fw={700} size="sm" tt="uppercase">Encrypted by MobileCoin protocol</Text>
        <Text fw={900} lh={1.05} size="2.5rem">Private payments. Decentralized exchange.</Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <FeatureCard
          description="Recovery phrase generation and account derivation always stay inside your browser, nobody has access to it."
          icon={IconFingerprint}
          title="Zero-Knowledge"
        />
        <FeatureCard
          description="We never touch, hold, or even see your transactions or assets. Everything always stays under your control."
          icon={IconBolt}
          title="Zero custody"
        />
      </SimpleGrid>

      <Stack gap="sm">
        <Button gradient={{ from: 'cyan', to: 'teal', deg: 135 }} onClick={() => navigate('/onboard/create')} radius="xl" size="lg" variant="gradient">
          Create New Wallet
        </Button>
        <Button onClick={() => navigate('/onboard/import')} radius="xl" size="lg" variant="default">
          Recover Existing Wallet
        </Button>
      </Stack>

      <Group justify="space-between">
        <Text c="dimmed" size="sm">Vault will be unlocked once your wallet is ready.</Text>
      </Group>
    </Stack>
  )
}
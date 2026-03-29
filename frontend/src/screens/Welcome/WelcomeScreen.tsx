import { Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconBolt, IconFingerprint } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { FeatureCard } from '../../components/FeatureCard/FeatureCard'

export function WelcomeScreen() {
  const navigate = useNavigate()

  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <Text c="cyan.3" fw={700} size="sm" tt="uppercase">Encrypted by MobileCoin protocol</Text>
        <Text fw={900} lh={1.05} size="2.5rem">Private payments. Decentralized exchange.</Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <FeatureCard
          description="Recovery phrase generation and account derivation always stay inside your browser."
          icon={IconFingerprint}
          title="Zero-Knowledge"
        />
        <FeatureCard
          description="We never touch, hold, or even see your assets. Everything always stays under your control."
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
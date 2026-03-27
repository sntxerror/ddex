import { Badge, Button, List, Stack, Text } from '@mantine/core'
import { useNavigate } from 'react-router'
import { SecurityScoreCard } from '../../components/SecurityScoreCard/SecurityScoreCard'
import { useSecurityScore } from '../../hooks/useSecurityScore'
import { useOnboardingStore } from '../../stores/onboardingStore'

export function OnboardCompleteScreen() {
  const navigate = useNavigate()
  const score = useSecurityScore()
  const { biometricsEnabled, completeWorkflow, mnemonicBackedUp, passphraseCreated } = useOnboardingStore()

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Badge color="teal" radius="xl" variant="light">Onboarding complete</Badge>
        <Text fw={800} size="xl">Your vault is ready</Text>
        <Text c="dimmed">You can enter the vault now, and any skipped step will continue showing up as a reminder instead of vanishing into the abyss.</Text>
      </Stack>

      <SecurityScoreCard />

      <List c="dimmed" spacing={6} size="sm">
        <List.Item>{mnemonicBackedUp ? 'Recovery phrase backed up' : 'Recovery phrase backup still pending'}</List.Item>
        <List.Item>{passphraseCreated ? 'Local passphrase configured' : 'Local passphrase skipped for now'}</List.Item>
        <List.Item>{biometricsEnabled ? 'Biometrics enabled placeholder accepted' : 'Biometrics left disabled'}</List.Item>
      </List>

      <Button
        gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
        onClick={() => {
          completeWorkflow()
          navigate('/profile')
        }}
        radius="xl"
        size="lg"
        variant="gradient"
      >
        Continue to Profile ({score.achieved.toFixed(1)}/10)
      </Button>
    </Stack>
  )
}
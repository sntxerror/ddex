import { Badge, Button, List, Stack, Text } from '@mantine/core'
import { useNavigate } from 'react-router'
import { SecurityScoreCard } from '../../components/SecurityScoreCard/SecurityScoreCard'
import { useSecurityScore } from '../../hooks/useSecurityScore'
import { useOnboardingStore } from '../../stores/onboardingStore'
import actionStyles from './OnboardActions.module.css'

export function OnboardCompleteScreen() {
  const navigate = useNavigate()
  const score = useSecurityScore()
  const completeWorkflow = useOnboardingStore((state) => state.completeWorkflow)

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Badge color="teal" radius="xl" variant="light">Onboarding complete</Badge>
        <Text fw={800} size="xl">Your wallet is ready</Text>
        <Text c="dimmed">You can enter now. Any skipped security step remains visible as a reminder until completed.</Text>
      </Stack>

      <SecurityScoreCard />

      <List c="dimmed" spacing={6} size="sm">
        <List.Item>Recovery phrase {score.pending.includes('Back up your recovery phrase') ? 'backup still pending' : 'backed up'}</List.Item>
        <List.Item>PIN lock {score.pending.includes('Set a local PIN lock') ? 'setup needed' : 'configured'}</List.Item>
        <List.Item>Biometrics {score.pending.includes('Enable biometric unlock') ? 'setup needed' : 'enabled'}</List.Item>
      </List>

      <Button
        className={actionStyles.actionButton}
        gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
        onClick={() => {
          completeWorkflow()
          navigate('/wallet')
        }}
        radius="xl"
        size="lg"
        variant="gradient"
      >
        Open Wallet ({score.achieved.toFixed(1)}/10)
      </Button>
    </Stack>
  )
}
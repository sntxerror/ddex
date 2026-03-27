import { Button, Group, Paper, Stack, Switch, Text } from '@mantine/core'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { useWalletStore } from '../../stores/walletStore'
import actionStyles from './OnboardActions.module.css'

export function EnableBiometricsScreen() {
  const navigate = useNavigate()
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const biometricsEnabled = useOnboardingStore((state) => state.biometricsEnabled)
  const completeBiometrics = useOnboardingStore((state) => state.completeBiometrics)
  const skipBiometrics = useOnboardingStore((state) => state.skipBiometrics)
  const [enabled, setEnabled] = useState(biometricsEnabled)

  if (!mnemonic) {
    return <Navigate replace to="/onboard/create" />
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Enable biometric unlock</Text>
        <Text c="dimmed">UI-only for now. This step reserves the future flow for Face ID / Touch ID / platform biometrics.</Text>
      </Stack>

      <Paper p="lg" radius="xl" withBorder>
        <Group justify="space-between">
          <Stack gap={2}>
            <Text fw={700}>Biometric Unlock</Text>
            <Text c="dimmed" size="sm">Use device biometrics for faster local unlocks.</Text>
          </Stack>
          <Switch checked={enabled} color="teal" onChange={(event) => setEnabled(event.currentTarget.checked)} size="lg" />
        </Group>
      </Paper>

      <Group grow>
        <Button
          className={actionStyles.actionButton}
          onClick={() => {
            skipBiometrics()
            navigate('/onboard/complete')
          }}
          radius="xl"
          variant="default"
        >
          Skip this step
        </Button>
        <Button
          className={actionStyles.actionButton}
          gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
          onClick={() => {
            completeBiometrics(enabled)
            navigate('/onboard/complete')
          }}
          radius="xl"
          variant="gradient"
        >
          Continue
        </Button>
      </Group>
    </Stack>
  )
}
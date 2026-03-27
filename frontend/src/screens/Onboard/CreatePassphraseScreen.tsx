import { PasswordInput, Progress, Button, Group, Stack, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { isValidWalletPassphrase, useWalletStore } from '../../stores/walletStore'

function getStrength(passphrase: string): number {
  return Math.min(100, (passphrase.trim().length / 16) * 100)
}

export function CreatePassphraseScreen() {
  const navigate = useNavigate()
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const saveVault = useKeystoreStore((state) => state.saveVault)
  const working = useKeystoreStore((state) => state.working)
  const skipPassphrase = useOnboardingStore((state) => state.skipPassphrase)
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')

  const isValid = useMemo(() => isValidWalletPassphrase(passphrase), [passphrase])
  const matches = confirmPassphrase === passphrase && confirmPassphrase.length > 0
  const strength = getStrength(passphrase)

  if (!mnemonic) {
    return <Navigate replace to="/onboard/create" />
  }

  const handleSave = async () => {
    const ok = await saveVault(passphrase)
    if (ok) {
      navigate('/onboard/biometrics')
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Create a local passphrase</Text>
        <Text c="dimmed">Use at least 8 letters or numbers. No special characters required — intentionally simple, not intentionally flimsy.</Text>
        <Text c="dimmed" size="sm">This protects the vault stored on this device. If you skip it, we’ll still offer biometric setup next.</Text>
      </Stack>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
      >
        <Stack gap="md">
          <PasswordInput
            autoComplete="new-password"
            label="Passphrase"
            name="new-device-passphrase"
            onChange={(event) => setPassphrase(event.currentTarget.value)}
            placeholder="8+ letters or numbers"
            radius="xl"
            value={passphrase}
          />
          <PasswordInput
            autoComplete="new-password"
            label="Confirm passphrase"
            name="confirm-device-passphrase"
            onChange={(event) => setConfirmPassphrase(event.currentTarget.value)}
            placeholder="Repeat passphrase"
            radius="xl"
            value={confirmPassphrase}
          />

          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="sm">Strength</Text>
              <Text c="dimmed" size="sm">{Math.round(strength)}%</Text>
            </Group>
            <Progress color="cyan" radius="xl" value={strength} />
          </Stack>

          {!isValid && passphrase.length > 0 ? <Text c="yellow.3" size="sm">Passphrase must be at least 8 characters and contain only letters or numbers.</Text> : null}
          {confirmPassphrase.length > 0 && !matches ? <Text c="yellow.3" size="sm">Confirmation does not match yet.</Text> : null}

          <Group grow>
            <Button
              onClick={() => {
                skipPassphrase()
                navigate('/onboard/biometrics')
              }}
              radius="xl"
              type="button"
              variant="default"
            >
              Skip this step
            </Button>
            <Button disabled={!isValid || !matches || working} gradient={{ from: 'cyan', to: 'teal', deg: 135 }} radius="xl" type="submit" variant="gradient">
              Secure Vault
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  )
}
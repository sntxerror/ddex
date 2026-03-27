import { Badge, Button, Group, Paper, PasswordInput, Stack, Switch, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useWalletStore } from '../../stores/walletStore'
import { isValidWalletPin } from '../../stores/walletStore'

export function SettingsScreen() {
  const navigate = useNavigate()
  const saveVault = useKeystoreStore((state) => state.saveVault)
  const deleteVault = useKeystoreStore((state) => state.deleteVault)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const working = useKeystoreStore((state) => state.working)
  const feedback = useWalletStore((state) => state.feedback)

  const [privacyShield, setPrivacyShield] = useState(true)
  const [biometricUnlock, setBiometricUnlock] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  const pinValid = useMemo(() => isValidWalletPin(pin), [pin])
  const pinMatches = pin === confirmPin && confirmPin.length > 0

  return (
    <Stack gap="lg">
      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={700}>PIN Lock</Text>
            {storedVault ? <Badge color="teal" radius="xl" variant="light">Encrypted wallet saved on this device</Badge> : null}
          </Group>

          <Group grow justify="space-between">
            <PasswordInput
            autoComplete="new-password"
            inputMode="numeric"
            label="PIN code"
            name="settings-pin"
            onChange={(event) => setPin(event.currentTarget.value.replace(/\D+/g, '').slice(0, 8))}
            placeholder="Enter 4–8 digits"
            radius="xl"
            value={pin}
          />
          <PasswordInput
            autoComplete="new-password"
            inputMode="numeric"
            label="Confirm PIN code"
            name="settings-pin-confirm"
            onChange={(event) => setConfirmPin(event.currentTarget.value.replace(/\D+/g, '').slice(0, 8))}
            placeholder="Repeat PIN code"
            radius="xl"
            value={confirmPin}
          />
          </Group>
          {!pinValid && pin.length > 0 ? <Text c="yellow.3" size="sm">PIN must be 4 to 8 digits.</Text> : null}
          {confirmPin.length > 0 && !pinMatches ? <Text c="yellow.3" size="sm">PIN confirmation does not match yet.</Text> : null}
          <Group grow>
            <Button
              disabled={!pinValid || !pinMatches || working}
              gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
              onClick={() => void saveVault(pin)}
              radius="xl"
              variant="gradient"
            >
              Save PIN Lock
            </Button>
          </Group>
          {feedback ? <Text c="dimmed" size="sm">{feedback}</Text> : null}
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Text fw={700}>Privacy & Security</Text>
          <Group justify="space-between">
            <Stack gap={2}>
              <Text fw={600}>Hide Amounts</Text>
              <Text c="dimmed" size="sm">Reduce balance exposure in shared spaces.</Text>
            </Stack>
            <Switch checked={privacyShield} color="teal" onChange={(event) => setPrivacyShield(event.currentTarget.checked)} />
          </Group>
          <Group justify="space-between">
            <Stack gap={2}>
              <Text fw={600}>Biometric Unlock</Text>
              <Text c="dimmed" size="sm">Placeholder toggle for platform passkeys/biometrics.</Text>
            </Stack>
            <Switch checked={biometricUnlock} color="teal" onChange={(event) => setBiometricUnlock(event.currentTarget.checked)} />
          </Group>
          <Button onClick={() => navigate('/profile/recovery-phrase')} radius="xl" type="button" variant="default">Recovery Phrase</Button>
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="md">
          <Text c="red.3" fw={700}>Deactivate Vault</Text>
          <Text c="dimmed" size="sm">Wipe all local website wallet data on this device. Recovery will require your saved mnemonic phrase.</Text>
          <Button color="red" onClick={() => void deleteVault()} radius="xl" variant={storedVault ? 'filled' : 'light'}>
            Delete Local Vault Data
          </Button>
        </Stack>
      </Paper>
    </Stack>
  )
}

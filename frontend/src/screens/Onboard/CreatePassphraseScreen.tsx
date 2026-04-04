import { Button, Group, Stack, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { PinInputField } from '../../components/PinInputField/PinInputField'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { getNextIncompleteStepFromCurrent, useOnboardingStore } from '../../stores/onboardingStore'
import { isValidWalletPin, useWalletStore } from '../../stores/walletStore'
import actionStyles from './OnboardActions.module.css'

export function CreatePassphraseScreen() {
  const navigate = useNavigate()
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const saveVault = useKeystoreStore((state) => state.saveVault)
  const working = useKeystoreStore((state) => state.working)
  const skipPassphrase = useOnboardingStore((state) => state.skipPassphrase)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  const isValid = useMemo(() => isValidWalletPin(pin), [pin])
  const matches = confirmPin === pin && confirmPin.length > 0

  if (!mnemonic) {
    return <Navigate replace to="/onboard/create" />
  }

  const handleSave = async () => {
    await saveVault(pin)
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Create a PIN lock</Text>
        <Text c="dimmed">Set a 4–8 digit PIN code to protect the encrypted wallet stored on this device.</Text>
        <Text c="dimmed" size="sm">Without a PIN, this wallet remains less secure on this browser. You can still continue and finish this later in Settings.</Text>
      </Stack>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
      >
        <Stack gap="md">
          <PinInputField
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            inputMode="numeric"
            name="new-device-pin"
            onChange={(event) => setPin(event.currentTarget.value.replace(/\D+/g, '').slice(0, 8))}
            placeholder="Enter 4–8 digits"
            radius="xl"
            value={pin}
          />
          <PinInputField
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            inputMode="numeric"
            name="confirm-device-pin"
            onChange={(event) => setConfirmPin(event.currentTarget.value.replace(/\D+/g, '').slice(0, 8))}
            placeholder="Repeat PIN code"
            radius="xl"
            value={confirmPin}
          />

          {!isValid && pin.length > 0 ? <Text c="yellow.3" size="sm">PIN must be 4 to 8 digits.</Text> : null}
          {confirmPin.length > 0 && !matches ? <Text c="yellow.3" size="sm">PIN confirmation does not match yet.</Text> : null}

          <Group grow>
            <Button
              className={actionStyles.actionButton}
              onClick={() => {
                skipPassphrase()
                navigate(getNextIncompleteStepFromCurrent('/onboard/pin', useOnboardingStore.getState()))
              }}
              radius="xl"
              type="button"
              variant="default"
            >
              Skip
            </Button>
            <Button className={actionStyles.actionButton} disabled={!isValid || !matches || working} gradient={{ from: 'cyan', to: 'teal', deg: 135 }} radius="xl" type="submit" variant="gradient">
              Set Pin
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  )
}
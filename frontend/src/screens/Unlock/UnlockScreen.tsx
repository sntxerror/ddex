import { Alert, Button, PasswordInput, Stack, Text } from '@mantine/core'
import { IconFingerprint } from '@tabler/icons-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { TESTNET_FOG_REPORT_URL } from '../../config'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useWalletStore } from '../../stores/walletStore'

export function UnlockScreen() {
  const navigate = useNavigate()
  const feedback = useWalletStore((state) => state.feedback)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const unlockVault = useKeystoreStore((state) => state.unlockVault)
  const working = useKeystoreStore((state) => state.working)
  const [passphrase, setPassphrase] = useState('')

  if (!storedVault) {
    return <Navigate replace to="/welcome" />
  }

  const handleUnlock = async () => {
    const ok = await unlockVault(passphrase, TESTNET_FOG_REPORT_URL)
    if (ok) {
      navigate('/wallet')
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Unlock your wallet</Text>
        <Text c="dimmed">This device already has an encrypted wallet. Enter your PIN code to derive the address back into memory.</Text>
      </Stack>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleUnlock()
        }}
      >
        <Stack gap="md">
          <PasswordInput
            autoComplete="current-password"
            inputMode="numeric"
            label="PIN code"
            name="device-pin"
            onChange={(event) => setPassphrase(event.currentTarget.value)}
            placeholder="Enter PIN code"
            radius="xl"
            value={passphrase}
          />

          <Button disabled={!passphrase.trim() || working} gradient={{ from: 'cyan', to: 'teal', deg: 135 }} radius="xl" size="lg" type="submit" variant="gradient">
            Unlock Wallet
          </Button>
        </Stack>
      </form>

      <Alert color="cyan" icon={<IconFingerprint size={18} />} radius="xl" variant="light">
        Biometric unlock is reserved for a later pass. Right now it is PIN unlock first.
      </Alert>

      {feedback ? <Text c="dimmed" size="sm">{feedback}</Text> : null}
    </Stack>
  )
}
import { Button, Group, Stack, Text } from '@mantine/core'
import { IconFingerprint } from '@tabler/icons-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { PinInputField } from '../../components/PinInputField/PinInputField'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useWalletStore } from '../../stores/walletStore'
import styles from './UnlockScreen.module.css'

const HIDDEN_FEEDBACK = new Set([
  '',
  'wallet-core is ready for local wallet derivation.',
  'Wallet relocked from header controls.',
  'Wallet relocked from memory.',
  'Wallet locked.',
])

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
    const ok = await unlockVault(passphrase)
    if (ok) {
      navigate('/wallet')
    }
  }

  const visibleFeedback = feedback && !HIDDEN_FEEDBACK.has(feedback) ? feedback : ''

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
          <PinInputField
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            inputMode="numeric"
            name="device-pin"
            onChange={(event) => setPassphrase(event.currentTarget.value.replace(/\D+/g, '').slice(0, 8))}
            placeholder="Enter PIN code"
            radius="xl"
            value={passphrase}
          />

          <Button className={styles.submitButton} disabled={!passphrase.trim() || working} gradient={{ from: 'cyan', to: 'teal', deg: 135 }} radius="xl" size="lg" type="submit" variant="gradient">
            Unlock Wallet
          </Button>
        </Stack>
      </form>

      <div className={styles.biometricCallout}>
        <Group className={styles.biometricGroup} gap="sm" justify="center" wrap="nowrap">
          <IconFingerprint className={styles.biometricFingerprint} size={18} stroke={1.9} />
          <Text className={styles.biometricText}>Biometric unlock is coming soon</Text>
        </Group>
      </div>

      {visibleFeedback ? <Text c="dimmed" size="sm">{visibleFeedback}</Text> : null}
    </Stack>
  )
}
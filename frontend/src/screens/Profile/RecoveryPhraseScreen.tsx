import { Alert, Button, Code, Stack, Text } from '@mantine/core'
import { Navigate, useNavigate } from 'react-router'
import { useWalletStore } from '../../stores/walletStore'

export function RecoveryPhraseScreen() {
  const navigate = useNavigate()
  const mnemonic = useWalletStore((state) => state.mnemonic)

  if (!mnemonic) {
    return <Navigate replace to="/unlock" />
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Recovery Phrase</Text>
        <Text c="dimmed">Treat this screen like plutonium with nicer typography.</Text>
      </Stack>
      <Alert color="yellow" radius="xl" variant="light">
        Never store this in plain text where other apps or screenshots can reach it.
      </Alert>
      <Code block>{mnemonic}</Code>
      <Button onClick={() => navigate('/profile')} radius="xl" variant="default">Back to Profile</Button>
    </Stack>
  )
}
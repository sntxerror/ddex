import { Button, Checkbox, Code, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { useWalletStore } from '../../stores/walletStore'

export function BackupMnemonicScreen() {
  const navigate = useNavigate()
  const completeMnemonicBackup = useOnboardingStore((state) => state.completeMnemonicBackup)
  const skipMnemonicBackup = useOnboardingStore((state) => state.skipMnemonicBackup)
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const [acknowledged, setAcknowledged] = useState(false)

  if (!mnemonic) {
    return <Navigate replace to="/onboard/create" />
  }

  const words = mnemonic.split(' ')

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Back up your recovery phrase</Text>
        <Text c="dimmed">If you lose this phrase, you lose access to your wallet and any assets tied to it. Dramatic, but accurate.</Text>
        <Text c="dimmed" size="sm">We recommend finishing this now. If you skip, the next screen will still offer passphrase protection before biometrics.</Text>
      </Stack>

      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
        {words.map((word, index) => (
          <Code block key={`${word}-${index}`}>{index + 1}. {word}</Code>
        ))}
      </SimpleGrid>

      <Checkbox
        checked={acknowledged}
        label="I have backed up my recovery phrase in a secure location, and I understand that losing it means losing wallet access."
        onChange={(event) => setAcknowledged(event.currentTarget.checked)}
        radius="xl"
      />

      <Group grow>
        <Button
          onClick={() => {
            skipMnemonicBackup()
            navigate('/onboard/passphrase')
          }}
          radius="xl"
          variant="default"
        >
          Skip this step
        </Button>
        <Button
          disabled={!acknowledged}
          gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
          onClick={() => {
            completeMnemonicBackup()
            navigate('/onboard/passphrase')
          }}
          radius="xl"
          variant="gradient"
        >
          I've Backed Up My Phrase
        </Button>
      </Group>
    </Stack>
  )
}
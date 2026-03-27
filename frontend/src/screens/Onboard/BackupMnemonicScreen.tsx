import { Alert, Button, Checkbox, Group, Stack, Text } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { RecoveryPhraseBlock } from '../../components/RecoveryPhraseBlock/RecoveryPhraseBlock'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { useWalletStore } from '../../stores/walletStore'
import actionStyles from './OnboardActions.module.css'

export function BackupMnemonicScreen() {
  const navigate = useNavigate()
  const skipMnemonicBackup = useOnboardingStore((state) => state.skipMnemonicBackup)
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const [acknowledged, setAcknowledged] = useState(false)

  if (!mnemonic) {
    return <Navigate replace to="/onboard/create" />
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Back up your recovery phrase</Text>
        <Text c="dimmed">Your recovery phrase is the only way to recover this wallet. If you lose it, wallet recovery is not possible.</Text>
      </Stack>

      <Alert color="yellow" icon={<IconInfoCircle size={18} />} radius="xl" variant="light">
        <Text c="yellow" size="sm">Until this phrase is backed up, your wallet should be considered temporary. If website data is cleared on this device, you’ll need this phrase to restore access.</Text>
      </Alert>

      <RecoveryPhraseBlock copyId="backup-phrase" mnemonic={mnemonic} />

      <Checkbox
        checked={acknowledged}
        label="I have backed up this phrase securely, and I understand it is required to recover my wallet if local data is removed."
        onChange={(event) => {
          const checked = event.currentTarget.checked
          setAcknowledged(checked)
        }}
        radius="xl"
      />

      <Group grow>
        <Button
          className={actionStyles.actionButton}
          onClick={() => {
            skipMnemonicBackup()
          }}
          radius="xl"
          variant="default"
        >
          Skip this step
        </Button>
        <Button
          className={actionStyles.actionButton}
          disabled={!acknowledged}
          gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
          onClick={() => navigate('/onboard/backup-check')}
          radius="xl"
          variant="gradient"
        >
          Verify Backup
        </Button>
      </Group>
    </Stack>
  )
}
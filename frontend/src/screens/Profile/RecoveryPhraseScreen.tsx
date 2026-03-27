import { ActionIcon, Alert, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconInfoCircle } from '@tabler/icons-react'
import { Navigate, useNavigate } from 'react-router'
import { RecoveryPhraseBlock } from '../../components/RecoveryPhraseBlock/RecoveryPhraseBlock'
import { useWalletStore } from '../../stores/walletStore'

export function RecoveryPhraseScreen() {
  const navigate = useNavigate()
  const mnemonic = useWalletStore((state) => state.mnemonic)

  if (!mnemonic) {
    return <Navigate replace to="/unlock" />
  }

  return (
    <Stack gap="lg">
      <Paper p="xl" radius="2rem" withBorder>
        <Stack gap="lg">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <Tooltip label="Back to Settings" withArrow>
                <ActionIcon aria-label="Back to Settings" onClick={() => navigate('/settings')} radius="xl" variant="default">
                  <IconArrowLeft size={16} />
                </ActionIcon>
              </Tooltip>
              <Text fw={800} size="xl">Recovery Phrase</Text>
            </Group>
            <Text c="dimmed">This phrase is the only way to restore your wallet if local device data is removed.</Text>
          </Stack>

          <Alert color="yellow" icon={<IconInfoCircle size={18} />} radius="xl" variant="light">
            <Text c="yellow" size="sm">Use password managers. Never store this in plain text where other apps, screenshots, or cloud notes can reach it.</Text>
          </Alert>

          <RecoveryPhraseBlock copyId="settings-recovery-phrase" mnemonic={mnemonic} />
        </Stack>
      </Paper>
    </Stack>
  )
}
import { ActionIcon, Alert, Button, Checkbox, Code, Group, Stack, Text } from '@mantine/core'
import { IconCopy, IconInfoCircle } from '@tabler/icons-react'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { useWalletStore } from '../../stores/walletStore'

export function BackupMnemonicScreen() {
  const completeMnemonicBackup = useOnboardingStore((state) => state.completeMnemonicBackup)
  const skipMnemonicBackup = useOnboardingStore((state) => state.skipMnemonicBackup)
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const [acknowledged, setAcknowledged] = useState(false)

  if (!mnemonic) {
    return <Navigate replace to="/onboard/create" />
  }

  const words = mnemonic.trim().split(/\s+/)
  const columnsPerRow = 3
  const rows: string[][] = []
  
  for (let i = 0; i < words.length; i += columnsPerRow) {
    rows.push(words.slice(i, i + columnsPerRow))
  }
  
  // Calculate max word length for consistent column widths
  const maxWordLength = Math.max(...words.map((w) => w.length))
  const columnWidth = maxWordLength + 4
  
  const phraseFormatted = rows
    .map((row) =>
      row
        .map((word) => word.padEnd(columnWidth))
        .join('')
        .trimEnd(),
    )
    .join('\n')

  const copyPhrase = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic.trim())
    } catch {
      // Best effort only.
    }
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

      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={700}>Recovery phrase</Text>
          <ActionIcon aria-label="Copy recovery phrase" onClick={() => void copyPhrase()} radius="xl" variant="default">
            <IconCopy size={16} />
          </ActionIcon>
        </Group>
        <Code
          block
          style={{
            whiteSpace: 'pre',
            fontFamily: '"Fira Code", "Courier New", monospace',
            fontSize: '14px',
            lineHeight: '1.8',
            letterSpacing: '0.5px',
            padding: '20px',
          }}
        >
          {phraseFormatted}
        </Code>
      </Stack>

      <Checkbox
        checked={acknowledged}
        label="I have backed up this phrase securely, and I understand it is required to recover my wallet if local data is removed."
        onChange={(event) => setAcknowledged(event.currentTarget.checked)}
        radius="xl"
      />

      <Group grow>
        <Button
          onClick={() => {
            skipMnemonicBackup()
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
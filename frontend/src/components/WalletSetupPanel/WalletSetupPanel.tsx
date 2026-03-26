import {
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core'
import { IconCopy, IconSparkles } from '@tabler/icons-react'
import styles from './WalletSetupPanel.module.css'
import type { WalletSetupMode, WalletSetupPanelProps } from './WalletSetupPanel.types'

function isWalletSetupMode(value: string): value is WalletSetupMode {
  return value === 'create' || value === 'import'
}

export function WalletSetupPanel({
  copiedMnemonic,
  displayedMnemonic,
  isDraftValid,
  mnemonicDraft,
  mode,
  wasmReady,
  wordCount,
  working,
  onCopyMnemonic,
  onCreate,
  onDraftChange,
  onImport,
  onModeChange,
}: WalletSetupPanelProps) {
  const handleModeChange = (value: string) => {
    if (isWalletSetupMode(value)) {
      onModeChange(value)
    }
  }

  return (
    <Paper className={styles.panel} p="xl" radius="xl" shadow="sm" withBorder>
      <Stack gap="lg">
        <div>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            Welcome wallet
          </Text>
          <Title mt="xs" order={2}>
            Create your DDEX wallet
          </Title>
          <Text c="dimmed" mt="xs" size="sm">
            Start with a fresh phrase or bring an existing one. Generation, validation, and key
            derivation happen locally inside your browser session.
          </Text>
        </div>

        <SegmentedControl
          data={[
            { label: 'Create wallet', value: 'create' },
            { label: 'Import phrase', value: 'import' },
          ]}
          fullWidth
          onChange={handleModeChange}
          value={mode}
        />

        {mode === 'create' ? (
          <Stack gap="md">
            <Paper className={styles.fieldCard} p="md" radius="lg" withBorder>
              <Stack gap="sm">
                <Group justify="space-between" wrap="wrap">
                  <div>
                    <Text fw={600}>Spin up a fresh 24-word wallet</Text>
                    <Text c="dimmed" size="sm">
                      Great for a first-run profile or a quick noncustodial testnet setup.
                    </Text>
                  </div>
                  <Button
                    disabled={working || !wasmReady}
                    leftSection={<IconSparkles size={16} />}
                    onClick={onCreate}
                  >
                    {working ? 'Deriving wallet…' : 'Generate locally'}
                  </Button>
                </Group>
              </Stack>
            </Paper>

            <Paper className={styles.fieldCard} p="md" radius="lg" withBorder>
              <Stack gap="sm">
                <Textarea
                  autosize
                  className={styles.textarea}
                  label="Recovery phrase"
                  minRows={5}
                  readOnly
                  value={displayedMnemonic}
                />
                <Group className={styles.helperRow} justify="space-between" wrap="wrap">
                  <Group gap="sm">
                    <Badge color="violet" variant="light">
                      {wordCount} words
                    </Badge>
                    <Text c="dimmed" size="sm">
                      Store it offline. Screenshots are convenient and a little too adventurous.
                    </Text>
                  </Group>
                  <Button
                    disabled={!displayedMnemonic}
                    leftSection={<IconCopy size={16} />}
                    onClick={onCopyMnemonic}
                    variant="light"
                  >
                    {copiedMnemonic ? 'Copied' : 'Copy phrase'}
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </Stack>
        ) : (
          <Paper className={styles.fieldCard} p="md" radius="lg" withBorder>
            <Stack gap="md">
              <Textarea
                autosize
                className={styles.textarea}
                label="Paste your BIP-39 recovery phrase"
                minRows={5}
                onChange={(event) => onDraftChange(event.currentTarget.value)}
                placeholder="abandon ability able about above absent ..."
                value={mnemonicDraft}
              />
              <Group className={styles.helperRow} justify="space-between" wrap="wrap">
                <Text className={styles.helperText} size="sm">
                  {mnemonicDraft.trim().length === 0 ? (
                    <span>Validation happens locally before anything is derived.</span>
                  ) : isDraftValid ? (
                    <span className={styles.valid}>Phrase looks valid and ready to unlock.</span>
                  ) : (
                    <span>Waiting for a valid BIP-39 English mnemonic.</span>
                  )}
                </Text>
                <Button disabled={working || !wasmReady} onClick={onImport}>
                  {working ? 'Importing…' : 'Import locally'}
                </Button>
              </Group>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Paper>
  )
}

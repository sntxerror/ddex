import { Group, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconSettings } from '@tabler/icons-react'
import styles from './SettingsGuidePanel.module.css'
import type { SettingsGuidePanelProps } from './SettingsGuidePanel.types'

const checklist = [
  'Save only after confirming the recovery phrase is backed up offline.',
  'Unlocking restores the mnemonic locally and immediately re-derives the wallet.',
  'Deleting the vault removes encrypted storage but does not affect offline backups.',
] as const

export function SettingsGuidePanel({ storageState }: SettingsGuidePanelProps) {
  return (
    <Paper className={styles.featureCard} p="xl" withBorder>
      <Stack gap="lg">
        <div>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            Settings guide
          </Text>
          <Title mt="xs" order={2}>
            Tune the local vault experience
          </Title>
          <Text c="dimmed" mt="sm" size="sm">
            Use Settings as the home for device trust decisions: save an encrypted vault, unlock it
            later, relock hot key material, or wipe the stored ciphertext from this browser.
          </Text>
        </div>

        <Stack gap="sm">
          {checklist.map((item) => (
            <Group align="flex-start" gap="sm" key={item} wrap="nowrap">
              <ThemeIcon color="violet" radius="xl" size="md" variant="light">
                <IconSettings size={14} />
              </ThemeIcon>
              <Text size="sm">{item}</Text>
            </Group>
          ))}
        </Stack>

        <Paper className={styles.miniCard} p="md" withBorder>
          <Text c="dimmed" size="xs" tt="uppercase">
            Current environment
          </Text>
          <Text fw={700} mt="xs" size="sm">
            {storageState === 'unsupported'
              ? 'Storage APIs unavailable in this browser'
              : 'IndexedDB + WebCrypto path detected'}
          </Text>
          <Text c="dimmed" mt="xs" size="sm">
            Vault metadata is visible only on this device and only after the local storage layer is
            opened successfully.
          </Text>
        </Paper>
      </Stack>
    </Paper>
  )
}

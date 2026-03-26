import {
  Badge,
  Button,
  Group,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { IconDatabase, IconDeviceFloppy, IconLock, IconTrash } from '@tabler/icons-react'
import styles from './SecureStoragePanel.module.css'
import type { SecureStoragePanelProps } from './SecureStoragePanel.types'

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function SecureStoragePanel({
  hasLoadedWallet,
  onDeleteStoredWallet,
  onRelockWallet,
  onSavePassphraseChange,
  onSaveToDevice,
  onUnlockFromDevice,
  onUnlockPassphraseChange,
  savePassphrase,
  status,
  storedVault,
  unlockPassphrase,
  working,
}: SecureStoragePanelProps) {
  const hasStoredVault = storedVault !== null

  return (
    <Paper className={styles.panel} p="xl" radius="xl" shadow="sm" withBorder>
      <Stack gap="lg">
        <div>
          <Text c="dimmed" fw={700} size="xs" tt="uppercase">
            Settings
          </Text>
          <Title mt="xs" order={2}>
            Vault & device security
          </Title>
          <Text c="dimmed" className={styles.supportText} mt="xs" size="sm">
            Keep DDEX noncustodial: encrypt the mnemonic locally with WebCrypto, store only
            ciphertext in IndexedDB, and unlock it later on the same device. No hosted recovery
            service, no custody handoff.
          </Text>
        </div>

        <Group gap="sm" wrap="wrap">
          <Badge color="indigo" leftSection={<IconDatabase size={14} />} variant="light">
            IndexedDB + AES-GCM
          </Badge>
          <Badge color="gray" variant="light">
            PBKDF2-SHA-256 key wrapping
          </Badge>
          {hasStoredVault ? (
            <Badge color="teal" variant="light">
              Vault saved on this device
            </Badge>
          ) : null}
        </Group>

        {status === 'unsupported' ? (
          <Paper className={styles.card} p="md" radius="lg" withBorder>
            <Text size="sm">
              This browser does not expose the IndexedDB + WebCrypto features needed for the local
              vault. Wallet derivation still works in memory, but device persistence is disabled.
            </Text>
          </Paper>
        ) : status === 'checking' ? (
          <Paper className={styles.card} p="md" radius="lg" withBorder>
            <Text size="sm">Checking for an existing encrypted wallet vault…</Text>
          </Paper>
        ) : status === 'error' ? (
          <Paper className={styles.card} p="md" radius="lg" withBorder>
            <Text size="sm">
              The browser storage layer could not be opened cleanly. Close other tabs using this app
              and try again.
            </Text>
          </Paper>
        ) : (
          <Stack gap="md">
            <Paper className={styles.card} p="md" radius="lg" withBorder>
              <Stack gap="md">
                <div>
                  <Text fw={600}>Save the current wallet to this device</Text>
                  <Text c="dimmed" mt={4} size="sm">
                    Wrap the mnemonic with a local-only passphrase before it touches IndexedDB. On
                    unlock, it is decrypted in-browser and re-derived through `wallet-core`.
                  </Text>
                </div>

                <PasswordInput
                  autoComplete="new-password"
                  description="Minimum 8 characters. This passphrase never leaves the browser."
                  disabled={!hasLoadedWallet || working}
                  label="Device vault passphrase"
                  onChange={(event) => onSavePassphraseChange(event.currentTarget.value)}
                  placeholder="Choose a strong local passphrase"
                  value={savePassphrase}
                />

                <Group className={styles.inlineActions} justify="space-between" wrap="wrap">
                  <Text c="dimmed" size="sm">
                    {hasLoadedWallet
                      ? hasStoredVault
                        ? 'Saving again updates the encrypted vault in place.'
                        : 'Your active wallet can be sealed into a local encrypted vault.'
                      : 'Generate, import, or unlock a wallet before saving it locally.'}
                  </Text>
                  <Button
                    disabled={!hasLoadedWallet || working}
                    leftSection={<IconDeviceFloppy size={16} />}
                    onClick={onSaveToDevice}
                  >
                    {working ? 'Saving vault…' : hasStoredVault ? 'Update vault' : 'Save vault'}
                  </Button>
                </Group>
              </Stack>
            </Paper>

            {hasStoredVault ? (
              <>
                <SimpleGrid className={styles.metaGrid} cols={{ base: 1, md: 3 }} spacing="sm">
                  <Paper className={styles.metaCard} p="md" radius="lg" withBorder>
                    <Text c="dimmed" size="xs" tt="uppercase">
                      Created
                    </Text>
                    <Text fw={600} mt="xs" size="sm">
                      {formatTimestamp(storedVault.createdAt)}
                    </Text>
                  </Paper>

                  <Paper className={styles.metaCard} p="md" radius="lg" withBorder>
                    <Text c="dimmed" size="xs" tt="uppercase">
                      Updated
                    </Text>
                    <Text fw={600} mt="xs" size="sm">
                      {formatTimestamp(storedVault.updatedAt)}
                    </Text>
                  </Paper>

                  <Paper className={styles.metaCard} p="md" radius="lg" withBorder>
                    <Text c="dimmed" size="xs" tt="uppercase">
                      KDF
                    </Text>
                    <Text fw={600} mt="xs" size="sm">
                      {storedVault.kdf} · {storedVault.iterations.toLocaleString()} rounds
                    </Text>
                  </Paper>
                </SimpleGrid>

                <Paper className={styles.card} p="md" radius="lg" withBorder>
                  <Stack gap="md">
                    <PasswordInput
                      autoComplete="current-password"
                      description="Unlock reads ciphertext from IndexedDB and decrypts it locally on this device."
                      disabled={working}
                      label="Unlock stored wallet"
                      onChange={(event) => onUnlockPassphraseChange(event.currentTarget.value)}
                      placeholder="Enter the vault passphrase"
                      value={unlockPassphrase}
                    />

                    <Group className={styles.inlineActions} justify="space-between" wrap="wrap">
                      <Group className={styles.inlineActions} wrap="wrap">
                        <Button
                          disabled={working}
                          leftSection={<IconLock size={16} />}
                          onClick={onUnlockFromDevice}
                          variant="light"
                        >
                          {working ? 'Unlocking…' : 'Unlock from device'}
                        </Button>
                        <Button
                          disabled={!hasLoadedWallet || working}
                          onClick={onRelockWallet}
                          variant="default"
                        >
                          Relock in-memory wallet
                        </Button>
                      </Group>

                      <Button
                        color="red"
                        disabled={working}
                        leftSection={<IconTrash size={16} />}
                        onClick={onDeleteStoredWallet}
                        variant="light"
                      >
                        Delete stored vault
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              </>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

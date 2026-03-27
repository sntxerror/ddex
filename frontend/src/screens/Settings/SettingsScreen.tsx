import { ActionIcon, Avatar, Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Switch, Text, Tooltip } from '@mantine/core'
import { IconCopy, IconShieldCheck } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { PinInputField } from '../../components/PinInputField/PinInputField'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { useSecurityScore } from '../../hooks/useSecurityScore'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { useUiStore } from '../../stores/uiStore'
import { useWalletStore } from '../../stores/walletStore'
import { createWalletAlias, formatAddress } from '../../types/wallet'
import { isValidWalletPin } from '../../stores/walletStore'
import styles from './SettingsScreen.module.css'

const HIDDEN_FEEDBACK = new Set([
  '',
  'wallet-core is ready for local wallet derivation.',
  'Encrypted wallet with PIN lock saved locally on this device.',
  'Wallet unlocked from the encrypted device keystore.',
  'Wallet locked.',
  'Local wallet data deleted and memory cleared.',
])

export function SettingsScreen() {
  const navigate = useNavigate()
  const score = useSecurityScore()
  const saveVault = useKeystoreStore((state) => state.saveVault)
  const deleteVault = useKeystoreStore((state) => state.deleteVault)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const working = useKeystoreStore((state) => state.working)
  const feedback = useWalletStore((state) => state.feedback)
  const address = useWalletStore((state) => state.address)
  const amountsHidden = useUiStore((state) => state.amountsHidden)
  const setAmountsHidden = useUiStore((state) => state.setAmountsHidden)
  const biometricUnlock = useOnboardingStore((state) => state.biometricsEnabled)
  const setBiometricsEnabled = useOnboardingStore((state) => state.setBiometricsEnabled)
  const { copiedKey, copyText } = useCopyFeedback()

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  const pinValid = useMemo(() => isValidWalletPin(pin), [pin])
  const pinMatches = pin === confirmPin && confirmPin.length > 0
  const alias = createWalletAlias(address)
  const addressDisplay = formatAddress(address)
  const scoreBadgeColor = score.pending.length === 0 ? 'teal' : score.achieved >= 6 ? 'cyan' : score.achieved >= 3 ? 'yellow' : 'red'
  const visibleFeedback = feedback && !HIDDEN_FEEDBACK.has(feedback) ? feedback : ''

  const copyAddress = async () => {
    if (!address) {
      return
    }

    await copyText('settings-address', address)
  }

  const handleDeleteVault = async () => {
    setDeleteDialogOpen(false)
    await deleteVault()
  }

  return (
    <>
      <Modal
        centered
        classNames={{ body: styles.confirmationDialogBody, content: styles.confirmationDialog, header: styles.confirmationDialogHeader }}
        onClose={() => setDeleteDialogOpen(false)}
        opened={deleteDialogOpen}
        overlayProps={{ backgroundOpacity: 0.55, blur: 4 }}
        radius="2rem"
        title={<Text className={styles.dangerTitle} fw={700}>Remove local vault data?</Text>}
        withCloseButton={false}
      >
        <Stack gap="lg">
          <Text c="dimmed" size="sm">
            This removes the encrypted wallet stored on this device. After removal, this wallet can only be restored with your recovery phrase.
          </Text>
          <Group grow>
            <Button className={styles.secondaryButton} onClick={() => setDeleteDialogOpen(false)} radius="xl" variant="default">
              Cancel
            </Button>
            <Button className={`${styles.secondaryButton} ${styles.dangerButton}`.trim()} onClick={() => void handleDeleteVault()} radius="xl" variant="default">
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Stack className={styles.root} gap="lg">
      <Paper p="xl" radius="2rem" withBorder>
        <Group align="center" justify="space-between">
          <Group>
            <Avatar color="cyan" radius="xl" size={56}>{alias.slice(0, 2).toUpperCase()}</Avatar>
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={800}>{alias}</Text>
                <Badge color={scoreBadgeColor} leftSection={<IconShieldCheck size={14} />} radius="xl" variant="light">
                  {score.achieved.toFixed(1)}/10
                </Badge>
              </Group>
              <Group className={styles.addressRow} gap="xs" wrap="nowrap">
                <Text c="dimmed" className={styles.addressText} size="sm">{addressDisplay}</Text>
                <Tooltip disabled={copiedKey !== 'settings-address'} label="Copied" opened={copiedKey === 'settings-address'} position="top" withArrow>
                  <ActionIcon aria-label="Copy wallet address" className={styles.copyButton} onClick={() => void copyAddress()} radius="xl" size="sm" variant="subtle">
                    <IconCopy size={15} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Stack>
          </Group>
          {storedVault ? <Badge color="teal" radius="xl" variant="light">Encrypted wallet saved on this device</Badge> : null}
        </Group>
      </Paper>

      <Paper p="xl" radius="2rem" withBorder>
        <Stack gap="lg">
          <Group justify="space-between">
            <Stack gap={2}>
              <Text fw={600}>Hide Amounts</Text>
              <Text c="dimmed" size="sm">Reduce balance exposure in shared spaces.</Text>
            </Stack>
            <Switch checked={amountsHidden} color="teal" onChange={(event) => setAmountsHidden(event.currentTarget.checked)} />
          </Group>
          <Group justify="space-between">
            <Stack gap={2}>
              <Text fw={600}>Biometric Unlock</Text>
              <Text c="dimmed" size="sm">Use the same local unlock preference chosen during onboarding.</Text>
            </Stack>
            <Switch checked={biometricUnlock} color="teal" onChange={(event) => setBiometricsEnabled(event.currentTarget.checked)} />
          </Group>

          <div className={styles.securityDivider} />

          <Stack className={styles.securitySubsection} gap="md">
            <Group align="flex-start" justify="space-between">
              <Stack gap={2}>
                <Text fw={700}>Pin Lock</Text>
                <Text c="dimmed" size="sm">Protect the encrypted wallet stored on this device with a 4–8 digit PIN code.</Text>
              </Stack>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              <PinInputField
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                inputMode="numeric"
                name="settings-pin"
                onChange={(event) => setPin(event.currentTarget.value.replace(/\D+/g, '').slice(0, 8))}
                placeholder="Enter 4–8 digits"
                radius="xl"
                value={pin}
              />
              <PinInputField
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                inputMode="numeric"
                name="settings-pin-confirm"
                onChange={(event) => setConfirmPin(event.currentTarget.value.replace(/\D+/g, '').slice(0, 8))}
                placeholder="Repeat PIN code"
                radius="xl"
                value={confirmPin}
              />
            </SimpleGrid>

            {!pinValid && pin.length > 0 ? <Text c="yellow.3" size="sm">PIN must be 4 to 8 digits.</Text> : null}
            {confirmPin.length > 0 && !pinMatches ? <Text c="yellow.3" size="sm">PIN confirmation does not match yet.</Text> : null}

            <Group grow>
              <Button
                className={styles.primaryButton}
                disabled={!pinValid || !pinMatches || working}
                gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
                onClick={() => void saveVault(pin)}
                radius="xl"
                variant="gradient"
              >
                Save Pin
              </Button>
            </Group>

            {visibleFeedback ? <Text c="dimmed" size="sm">{visibleFeedback}</Text> : null}
          </Stack>

          <Group grow>
            <Button className={styles.secondaryButton} onClick={() => navigate('/settings/recovery-phrase')} radius="xl" type="button" variant="default">Recovery Phrase</Button>
          </Group>
        </Stack>
      </Paper>

      <Paper className={styles.dangerCard} p="xl" radius="2rem" withBorder>
        <Stack gap="md">
          <Text className={styles.dangerTitle} fw={700}>Deactivate Vault</Text>
          <Text c="dimmed" size="sm">Wipe all local website wallet data on this device. Recovery will require your saved mnemonic phrase.</Text>
          <Button className={`${styles.secondaryButton} ${styles.dangerButton}`.trim()} onClick={() => setDeleteDialogOpen(true)} radius="xl" variant="default">
            Delete Local Vault Data
          </Button>
        </Stack>
      </Paper>
      </Stack>
    </>
  )
}

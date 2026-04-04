import { ActionIcon, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core'
import { IconArrowUpRight, IconCopy, IconDownload, IconQrcode } from '@tabler/icons-react'
import { useState } from 'react'
import { NavLink } from 'react-router'
import { QrScannerModal } from '../../components/QrScannerModal/QrScannerModal'
import { useTransferStore } from '../../stores/transferStore'
import { useUiStore } from '../../stores/uiStore'
import { useBalanceStore, formatMob } from '../../stores/balanceStore'
import styles from './TransferFlow.module.css'

function sanitizeAmountInput(value: string): string {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '')
  const [wholePartRaw = '', ...fractionalParts] = normalized.split('.')
  const hasDecimal = normalized.includes('.')
  const whole = wholePartRaw.replace(/^0+(?=\d)/, '') || (wholePartRaw ? '0' : '')
  const cents = fractionalParts.join('').slice(0, 2)

  if (!hasDecimal) {
    return whole
  }

  return `${whole || '0'}.${cents}`
}

function formatAmountOnBlur(value: string): string {
  const sanitized = sanitizeAmountInput(value)

  if (!sanitized) {
    return ''
  }

  const [wholePart = '0', centsPart = ''] = sanitized.split('.')
  const whole = wholePart.replace(/^0+(?=\d)/, '') || '0'
  const cents = centsPart.padEnd(2, '0').slice(0, 2)

  return `${whole}.${cents}`
}

export function TransferScreen() {
  const amount = useTransferStore((state) => state.amount)
  const recipient = useTransferStore((state) => state.recipient)
  const status = useTransferStore((state) => state.status)
  const buildPhase = useTransferStore((state) => state.buildPhase)
  const buildDetail = useTransferStore((state) => state.buildDetail)
  const error = useTransferStore((state) => state.error)
  const setAmount = useTransferStore((state) => state.setAmount)
  const setRecipient = useTransferStore((state) => state.setRecipient)
  const send = useTransferStore((state) => state.send)
  const reset = useTransferStore((state) => state.reset)
  const amountsHidden = useUiStore((state) => state.amountsHidden)
  const balancePicoMob = useBalanceStore((state) => state.balancePicoMob)
  const balanceDisplay = formatMob(balancePicoMob)

  const [scannerOpen, setScannerOpen] = useState(false)
  const isBusy = status === 'building' || status === 'submitting'
  const canSubmit = status === 'ready' && !isBusy

  const pasteFromClipboard = async () => {
    try {
      const clipboardValue = await navigator.clipboard.readText()
      setRecipient(clipboardValue)
    } catch {
      // Best effort only.
    }
  }

  const handleAmountChange = (value: string) => {
    setAmount(sanitizeAmountInput(value))
  }

  const handleAmountBlur = () => {
    setAmount(formatAmountOnBlur(amount))
  }

  return (
    <Stack className={styles.root} gap="lg">
      <div className={styles.modeTabs}>
        <NavLink className={({ isActive }) => `${styles.modeTab} ${isActive ? styles.modeTabActive : ''}`.trim()} to="/transfer/send">
          <span className={styles.modeTabContent}>
            <IconArrowUpRight className={styles.modeTabIcon} size={16} />
            <span>Send</span>
          </span>
        </NavLink>
        <NavLink className={({ isActive }) => `${styles.modeTab} ${isActive ? styles.modeTabActive : ''}`.trim()} to="/transfer/receive">
          <span className={styles.modeTabContent}>
            <IconDownload className={styles.modeTabIcon} size={16} />
            <span>Receive</span>
          </span>
        </NavLink>
      </div>

      <Paper className={styles.heroCard} p="xl" radius="2rem" withBorder>
        <Stack gap="lg">
          <Stack gap="xs">
            <Text className={styles.helperText} size="sm">Enter an amount and recipient address to prepare a private transfer from your vault.</Text>
          </Stack>

          <div className={styles.fieldSection}>
            <div className={styles.fieldLabelRow}>
              <Text fw={700}>Amount</Text>
              <Text className={styles.balanceMeta} size="sm">Available: {amountsHidden ? '***.*** MOB' : `${balanceDisplay} MOB`}</Text>
            </div>
            <TextInput
              className={`${styles.fieldInput} ${styles.amountInput}`.trim()}
              onChange={(event) => handleAmountChange(event.currentTarget.value)}
              onBlur={handleAmountBlur}
              placeholder="0.00 MOB"
              radius="xl"
              rightSection={
                <Button className={styles.inlineAllButton} onClick={() => setAmount(balanceDisplay)} radius="xl" size="compact-sm" variant="subtle">
                  ALL
                </Button>
              }
              rightSectionPointerEvents="all"
              rightSectionWidth={76}
              value={amount}
            />
          </div>


          <div className={styles.fieldSection}>
            <Text fw={700}>Receiver Address</Text>
            <TextInput
              className={`${styles.fieldInput} ${styles.receiverInput}`.trim()}
              onChange={(event) => setRecipient(event.currentTarget.value)}
              placeholder="Paste or scan a MobileCoin address"
              radius="xl"
              rightSection={
                <Group className={styles.receiverActions} gap={6} mr={8} wrap="nowrap">
                  <ActionIcon aria-label="Paste address" className={styles.addressAction} onClick={() => void pasteFromClipboard()} radius="xl" size="md" variant="subtle">
                    <IconCopy size={18} />
                  </ActionIcon>
                  <ActionIcon aria-label="Scan QR" className={styles.addressAction} onClick={() => setScannerOpen(true)} radius="xl" size="md" variant="subtle">
                    <IconQrcode size={18} />
                  </ActionIcon>
                </Group>
              }
              rightSectionPointerEvents="all"
              rightSectionWidth={92}
              value={recipient}
            />
          </div>


          <Button
            className={styles.submitButton}
            disabled={!canSubmit}
            gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
            loading={isBusy}
            onClick={() => void send()}
            radius="xl"
            size="lg"
            variant="gradient"
          >
            {isBusy ? (buildDetail || buildPhase || 'Processing...') : 'Send MOB →'}
          </Button>

          {scannerOpen && (
            <QrScannerModal
              onClose={() => setScannerOpen(false)}
              onScan={(value) => setRecipient(value)}
            />
          )}

          {status === 'failed' && error && (
            <Text c="red" size="sm" ta="center">{error}</Text>
          )}

          {status === 'submitted' && (
            <Stack gap="xs">
              <Text c="teal" size="sm" ta="center">
                Transaction submitted successfully!
              </Text>
              <Text c="dimmed" size="xs" ta="center">{buildDetail}</Text>
              <Button onClick={reset} radius="xl" size="compact-sm" variant="subtle">
                Send Another
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}
import { Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { IconArrowUpRight, IconCopy, IconDownload, IconShare } from '@tabler/icons-react'
import { QRCodeSVG } from 'qrcode.react'
import { NavLink } from 'react-router'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { useWalletStore } from '../../stores/walletStore'
import { formatAddress } from '../../types/wallet'
import styles from './TransferFlow.module.css'

export function ReceiveScreen() {
  const address = useWalletStore((state) => state.address)
  const shortenedAddress = formatAddress(address)
  const { copiedKey, copyText } = useCopyFeedback()

  const copy = async (key: string) => {
    if (!address) {
      return
    }

    await copyText(key, address)
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
        <Stack gap="md">
          <Stack gap="xs">
            <Text className={styles.helperText} size="sm">Share this QR code or wallet address to receive deposits into your vault.</Text>
          </Stack>

          <div className={styles.receiveQrWrap}>
            <QRCodeSVG bgColor="transparent" fgColor="currentColor" includeMargin size={220} style={{ color: 'var(--ddex-text-primary)', maxWidth: '100%', height: 'auto' }} value={address || 'ddex'} />
          </div>

          <Stack align="center" className={styles.receiveMeta} gap="xs">
            <Text className={styles.receiveAddressText}>{shortenedAddress}</Text>

            <Group className={styles.receiveInlineActions} gap="xs" justify="center" wrap="wrap">
              <Tooltip disabled={copiedKey !== 'receive-address-copy'} label="Copied" opened={copiedKey === 'receive-address-copy'} position="top" withArrow>
                <Button className={styles.receiveInlineAction} leftSection={<IconCopy size={16} />} onClick={() => void copy('receive-address-copy')} radius="xl" variant="subtle">
                  Copy
                </Button>
              </Tooltip>
              <Button className={styles.receiveInlineAction} disabled leftSection={<IconShare size={16} />} radius="xl" variant="subtle">
                Share
              </Button>
            </Group>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  )
}
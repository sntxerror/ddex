import { Button, Paper, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import styles from './WarningBanner.module.css'

interface WarningBannerProps {
  readonly items: string[]
  readonly title?: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}

export function WarningBanner({
  items,
  title = 'Security setup incomplete',
  actionLabel,
  onAction,
}: WarningBannerProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <Paper className={styles.card} p="xl" radius="2rem" withBorder>
      <div className={styles.content}>
        <Stack className={styles.copy} gap="md">
          <div className={styles.header}>
            <IconAlertTriangle className={styles.icon} size={18} />
            <Text className={styles.title} fw={700}>
              {title}
            </Text>
          </div>
          <Text className={styles.bodyText} size="sm">
            Your wallet is considered temporary until the recovery phrase is backed up, and is not secure until PIN lock and biometrics are configured.
          </Text>
        </Stack>
        {actionLabel && onAction ? (
          <Button className={styles.actionButton} onClick={onAction} radius="xl" variant="default">
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </Paper>
  )
}
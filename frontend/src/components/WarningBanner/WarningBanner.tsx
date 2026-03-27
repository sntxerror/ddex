import { Alert, Button, List, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'

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
    <Alert color="red" icon={<IconAlertTriangle size={18} />} radius="xl" title={title} variant="light">
      <Stack gap="md">
        <Text c="red" size="sm">
          Your wallet is considered temporary until the recovery phrase is backed up, and is not secure until PIN lock and biometrics are configured.
        </Text>
        {actionLabel && onAction ? (
          <Button onClick={onAction} radius="xl" size="sm" variant="light">
            {actionLabel}
          </Button>
        ) : null}
      </Stack>
    </Alert>
  )
}
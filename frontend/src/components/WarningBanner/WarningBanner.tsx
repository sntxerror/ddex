import { Alert, List, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'

interface WarningBannerProps {
  readonly items: string[]
  readonly title?: string
}

export function WarningBanner({ items, title = 'Security reminders' }: WarningBannerProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <Alert color="yellow" icon={<IconAlertTriangle size={18} />} radius="xl" title={title} variant="light">
      <Text c="dimmed" mb="xs" size="sm">A few asecurity setup tasks are still pending before this vault gets its full protection and persistence.</Text>
      <List c="dimmed" size="sm" spacing={4}>
        {items.map((item) => (
          <List.Item key={item}>{item}</List.Item>
        ))}
      </List>
    </Alert>
  )
}
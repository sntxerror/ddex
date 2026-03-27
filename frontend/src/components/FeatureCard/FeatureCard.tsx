import { Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import type { TablerIcon } from '@tabler/icons-react'

interface FeatureCardProps {
  readonly description: string
  readonly icon: TablerIcon
  readonly title: string
}

export function FeatureCard({ description, icon: Icon, title }: FeatureCardProps) {
  return (
    <Paper p="lg" radius="xl" withBorder>
      <Stack gap="sm">
        <ThemeIcon color="cyan" radius="xl" size="lg" variant="light">
          <Icon size={18} />
        </ThemeIcon>
        <Text fw={700}>{title}</Text>
        <Text c="dimmed" size="sm">{description}</Text>
      </Stack>
    </Paper>
  )
}
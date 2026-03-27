import { Badge, Group, Paper, Progress, Stack, Text } from '@mantine/core'
import { useSecurityScore } from '../../hooks/useSecurityScore'
import styles from './SecurityScoreCard.module.css'

interface SecurityScoreCardProps {
  readonly compact?: boolean
}

export function SecurityScoreCard({ compact = false }: SecurityScoreCardProps) {
  const score = useSecurityScore()

  return (
    <Paper className={styles.card} p={compact ? 'md' : 'lg'} radius="xl">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={700} size="sm" tt="uppercase">Security Level</Text>
          <Badge color="cyan" radius="xl" variant="light">{score.label}</Badge>
        </Group>

        <Text className={styles.score}>{score.achieved.toFixed(1)}</Text>
        <Text c="dimmed" size="sm">Out of {score.total}. Every completed step hardens the local wallet experience.</Text>
        <Progress color="cyan" radius="xl" value={(score.achieved / score.total) * 100} />
      </Stack>
    </Paper>
  )
}
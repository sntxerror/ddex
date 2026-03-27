import { Badge, Group, Paper, Progress, Stack, Text } from '@mantine/core'
import { useSecurityScore } from '../../hooks/useSecurityScore'
import styles from './SecurityScoreCard.module.css'

interface SecurityScoreCardProps {
  readonly actionLabel?: string
  readonly compact?: boolean
  readonly onClick?: () => void
}

export function SecurityScoreCard({ actionLabel, compact = false, onClick }: SecurityScoreCardProps) {
  const score = useSecurityScore()
  const isComplete = score.pending.length === 0
  const badgeColor = isComplete ? 'teal' : score.achieved >= 6 ? 'cyan' : score.achieved >= 3 ? 'yellow' : 'red'

  return (
    <Paper
      className={`${styles.card} ${onClick ? styles.cardInteractive : ''}`.trim()}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      } : undefined}
      p={compact ? 'md' : 'lg'}
      radius="xl"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={700} size="sm" tt="uppercase">Security Level</Text>
          <Badge color={badgeColor} radius="xl" variant="light">{score.label}</Badge>
        </Group>

        <Text className={styles.score}>{score.achieved.toFixed(1)}</Text>
        <Text c="dimmed" size="sm">
          {isComplete
            ? `Out of ${score.total}. All security steps are complete — no action needed.`
            : `Out of ${score.total}. Finish the next incomplete security step to harden this wallet.`}
        </Text>
        <Progress color="cyan" radius="xl" value={(score.achieved / score.total) * 100} />
        {actionLabel ? <Text c={isComplete ? 'teal.4' : 'cyan.4'} fw={600} size="sm">{actionLabel}</Text> : null}
      </Stack>
    </Paper>
  )
}
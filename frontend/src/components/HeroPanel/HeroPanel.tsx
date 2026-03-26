import {
  Alert,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconBolt,
  IconInfoCircle,
} from '@tabler/icons-react'
import styles from './HeroPanel.module.css'
import type { HeroPanelNotice, HeroPanelProps, HeroPanelTone } from './HeroPanel.types'

const statusToneToColor: Record<HeroPanelTone, string> = {
  error: 'red',
  loading: 'yellow',
  ready: 'teal',
}

function renderNoticeIcon(notice: HeroPanelNotice) {
  if (notice.tone === 'error') {
    return <IconAlertCircle size={18} />
  }

  return <IconInfoCircle size={18} />
}

export function HeroPanel({
  aside,
  description,
  eyebrow,
  highlights,
  notice,
  statusLabel,
  stats,
  title,
  statusTone,
}: HeroPanelProps) {

  return (
    <Paper className={styles.panel} p="xl" radius="xl" shadow="md" withBorder>
      <Stack className={styles.content} gap="lg">
        <div className={styles.layout}>
          <Stack className={styles.copyColumn} gap="lg">
            <Group className={styles.statusRow} gap="sm" wrap="wrap">
              <Badge
                className={styles.statusBadge}
                color={statusToneToColor[statusTone]}
                leftSection={<IconBolt size={14} />}
                size="lg"
                variant="light"
              >
                {statusLabel}
              </Badge>
              <Text className={styles.eyebrow} fw={700} size="xs" tt="uppercase">
                {eyebrow}
              </Text>
            </Group>

            <div>
              <Title className={styles.heroTitle} order={1}>
                {title}
              </Title>
              <Text c="dimmed" className={styles.heroText} mt="md" size="lg">
                {description}
              </Text>
            </div>

            <Group className={styles.featureList} gap="sm" wrap="wrap">
              {highlights.map((highlight) => (
                <Badge className={styles.featureBadge} key={highlight} size="lg" variant="white">
                  {highlight}
                </Badge>
              ))}
            </Group>

            <SimpleGrid className={styles.statsGrid} cols={{ base: 1, sm: 3 }} spacing="sm">
              {stats.map((stat) => (
                <Paper className={styles.statCard} key={stat.label} p="md" radius="lg" withBorder>
                  <Text c="dimmed" size="xs" tt="uppercase">
                    {stat.label}
                  </Text>
                  <Text fw={700} mt="xs" size="lg">
                    {stat.value}
                  </Text>
                </Paper>
              ))}
            </SimpleGrid>
          </Stack>

          {aside ? <div className={styles.asideColumn}>{aside}</div> : null}
        </div>

        {notice ? (
          <Alert
            className={styles.notice}
            color={notice.tone === 'error' ? 'red' : 'blue'}
            icon={renderNoticeIcon(notice)}
            radius="lg"
            variant="light"
          >
            {notice.message}
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  )
}

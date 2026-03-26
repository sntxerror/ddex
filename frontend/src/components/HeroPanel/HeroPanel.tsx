import {
  ActionIcon,
  Alert,
  Badge,
  Code,
  Group,
  Paper,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconBolt,
  IconInfoCircle,
  IconMoonStars,
  IconPackageExport,
  IconSunHigh,
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

export function HeroPanel({ notice, statusLabel, statusTone }: HeroPanelProps) {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  return (
    <Paper className={styles.panel} p="xl" radius="xl" shadow="md" withBorder>
      <Stack className={styles.content} gap="lg">
        <Group className={styles.header} justify="space-between" wrap="wrap">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Badge
                className={styles.statusBadge}
                color={statusToneToColor[statusTone]}
                leftSection={<IconBolt size={14} />}
                size="lg"
                variant="light"
              >
                {statusLabel}
              </Badge>

              <ActionIcon
                aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                className={styles.themeToggle}
                onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
                size="lg"
              >
                {isDark ? <IconSunHigh size={18} /> : <IconMoonStars size={18} />}
              </ActionIcon>
            </Group>

            <div>
              <Title className={styles.heroTitle} order={1}>
                Wallet foundation preview
              </Title>
              <Text c="dimmed" className={styles.heroText} mt="md" size="lg">
                The frontend now targets the real MobileCoin wallet-core exports instead of the retired
                Game of Life demo. Create or import a mnemonic below to derive an account and default
                receive address locally in the browser.
              </Text>
            </div>
          </Stack>

          <Paper className={styles.pipelineCard} p="md" radius="lg" withBorder>
            <Stack gap="sm">
              <Group gap="xs" wrap="nowrap">
                <IconPackageExport size={18} />
                <Text fw={700}>Build pipeline</Text>
              </Group>
              <Text c="dimmed" size="sm">
                Canonical generated package lives in <Code className={styles.pipelineCode}>ddex/wasm/pkg</Code>{' '}
                and gets synced into the frontend before dev, lint, typecheck, build, and preview.
              </Text>
            </Stack>
          </Paper>
        </Group>

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

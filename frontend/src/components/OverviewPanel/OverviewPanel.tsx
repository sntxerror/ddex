import {
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import {
  IconArrowRight,
  IconChartArrowsVertical,
  IconMapPin,
  IconShieldLock,
  IconWallet,
} from '@tabler/icons-react'
import styles from './OverviewPanel.module.css'
import type { OverviewPanelProps } from './OverviewPanel.types'

export function OverviewPanel({
  fogReportUrl,
  keyMaterialBytes,
  onOpenAddress,
  onOpenSettings,
  securityChecklist,
  summaryItems,
}: OverviewPanelProps) {
  return (
    <Stack gap="xl">
      <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="lg">
        {summaryItems.map((item) => (
          <Paper className={styles.summaryCard} key={item.label} p="lg" withBorder>
            <Stack gap="xs">
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                {item.label}
              </Text>
              <Text className={styles.summaryValue} fw={700} size="lg">
                {item.value}
              </Text>
              <Text c="dimmed" size="sm">
                {item.description}
              </Text>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
        <Paper className={styles.featureCard} p="xl" withBorder>
          <Stack gap="lg">
            <div>
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                Profile overview
              </Text>
              <Title mt="xs" order={2}>
                Your DDEX control center
              </Title>
              <Text c="dimmed" mt="sm" size="sm">
                This page is the friendly front door: set up a wallet, confirm your readiness, and
                jump into address sharing or vault management without digging through developer-ish
                panels.
              </Text>
            </div>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <Paper className={styles.miniCard} p="md" withBorder>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color="violet" radius="xl" size="lg" variant="light">
                    <IconWallet size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} size="sm">Wallet setup</Text>
                    <Text c="dimmed" size="xs">Local phrase generation or import</Text>
                  </div>
                </Group>
              </Paper>

              <Paper className={styles.miniCard} p="md" withBorder>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color="teal" radius="xl" size="lg" variant="light">
                    <IconChartArrowsVertical size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} size="sm">DEX readiness</Text>
                    <Text c="dimmed" size="xs">Proxy-backed path for network features</Text>
                  </div>
                </Group>
              </Paper>

              <Paper className={styles.miniCard} p="md" withBorder>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color="indigo" radius="xl" size="lg" variant="light">
                    <IconShieldLock size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} size="sm">Vault options</Text>
                    <Text c="dimmed" size="xs">Encrypted IndexedDB storage in Settings</Text>
                  </div>
                </Group>
              </Paper>
            </SimpleGrid>

            <Group gap="sm" wrap="wrap">
              <Button onClick={onOpenAddress} rightSection={<IconArrowRight size={16} />}>
                Open my wallet address
              </Button>
              <Button onClick={onOpenSettings} variant="light">
                Open settings
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper className={styles.featureCard} p="xl" withBorder>
          <Stack gap="lg">
            <div>
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                Safety posture
              </Text>
              <Title mt="xs" order={2}>
                Noncustodial by design
              </Title>
              <Text c="dimmed" mt="sm" size="sm">
                DDEX keeps wallet operations local-first: mnemonic validation, address derivation,
                and device vault encryption all happen in the browser. In other words, your secrets
                don’t need a field trip.
              </Text>
            </div>

            <Stack gap="sm">
              {securityChecklist.map((item) => (
                <Group align="flex-start" gap="sm" key={item} wrap="nowrap">
                  <ThemeIcon color="indigo" radius="xl" size="md" variant="light">
                    <IconShieldLock size={14} />
                  </ThemeIcon>
                  <Text size="sm">{item}</Text>
                </Group>
              ))}
            </Stack>

            <Divider />

            <Group className={styles.inlineMeta} justify="space-between" wrap="wrap">
              <Group c="dimmed" gap="xs" wrap="nowrap">
                <IconMapPin size={16} />
                <Text size="sm">Fog route: {fogReportUrl}</Text>
              </Group>
              <Badge color="violet" variant="light">
                {keyMaterialBytes > 0 ? `${keyMaterialBytes} bytes in memory` : 'No keys in memory'}
              </Badge>
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  )
}

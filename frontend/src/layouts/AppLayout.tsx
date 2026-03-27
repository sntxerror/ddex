import { ActionIcon, AppShell, Group, Stack, Text, useMantineColorScheme } from '@mantine/core'
import { IconMoonStars, IconSunHigh } from '@tabler/icons-react'
import { Outlet, useNavigate } from 'react-router'
import { BottomTabBar } from '../components/BottomTabBar/BottomTabBar'
import { WarningBanner } from '../components/WarningBanner/WarningBanner'
import { useSecurityScore } from '../hooks/useSecurityScore'
import { getNextIncompleteOnboardingPath, useOnboardingStore } from '../stores/onboardingStore'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const navigate = useNavigate()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const score = useSecurityScore()
  const nextIncompleteOnboardingPath = useOnboardingStore(getNextIncompleteOnboardingPath)
  const isDark = colorScheme === 'dark'


  return (
    <AppShell className={styles.shell} footer={{ height: 84 }} header={{ height: 68 }} padding={0}>
      <AppShell.Header className={styles.header}>
        <Group className={styles.frame} h="100%" justify="space-between" px="md">
          <Stack gap={0}>
            <Group gap="xs">
              <Text fw={700} size="sm" tt="uppercase">DDEX</Text>
            </Group>
            <Text c="dimmed" size="xs">Private payments. Decentralized exchange.</Text>
          </Stack>

          <Group gap="xs">
            <ActionIcon
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
              radius="xl"
              size="lg"
              variant="default"
            >
              {isDark ? <IconSunHigh size={18} /> : <IconMoonStars size={18} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main className={styles.main}>
        <div className={styles.frame}>
          <Stack gap="lg">
            <WarningBanner
              items={score.pending}
              actionLabel={nextIncompleteOnboardingPath ? 'Continue Security Setup' : undefined}
              onAction={nextIncompleteOnboardingPath ? () => navigate(nextIncompleteOnboardingPath) : undefined}
            />
            <Outlet />
          </Stack>
        </div>
      </AppShell.Main>

      <AppShell.Footer className={styles.footer}>
        <div className={styles.frame}>
          <BottomTabBar />
        </div>
      </AppShell.Footer>
    </AppShell>
  )
}
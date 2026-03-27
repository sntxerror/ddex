import { ActionIcon, Group, Stack, Text, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconLock, IconMoonStars, IconSunHigh } from '@tabler/icons-react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { BottomTabBar } from '../components/BottomTabBar/BottomTabBar'
import { WarningBanner } from '../components/WarningBanner/WarningBanner'
import { useSecurityScore } from '../hooks/useSecurityScore'
import { useKeystoreStore } from '../stores/keystoreStore'
import { getNextIncompleteOnboardingPath, useOnboardingStore } from '../stores/onboardingStore'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const score = useSecurityScore()
  const nextIncompleteOnboardingPath = useOnboardingStore(getNextIncompleteOnboardingPath)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const lockSession = useKeystoreStore((state) => state.lockSession)
  const isDark = colorScheme === 'dark'

  const title = location.pathname.startsWith('/wallet')
    ? 'Dashboard'
    : location.pathname.startsWith('/transfer')
      ? 'Transfer'
      : location.pathname.startsWith('/profile')
        ? 'Profile'
        : location.pathname.startsWith('/settings')
          ? 'Settings'
          : 'DDEX'


  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <Stack gap="lg">
          <div className={styles.headerWrap}>
            <div className={styles.headerBar}>
              <Group className={styles.headerControlsLeft} gap="xs" wrap="nowrap">
                <Tooltip label={storedVault ? 'Lock wallet' : 'Save a PIN lock first'}>
                  <ActionIcon
                    aria-label="Lock wallet"
                    className={styles.headerAction}
                    disabled={!storedVault}
                    onClick={() => {
                      if (!storedVault) {
                        return
                      }

                      lockSession('Wallet relocked from header controls.')
                      navigate('/unlock')
                    }}
                    radius="xl"
                    size="lg"
                    variant="default"
                  >
                    <IconLock size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              <div className={styles.headerTitleWrap}>
                <Text className={styles.headerTitle} fw={800}>{title}</Text>
              </div>

              <Group className={styles.headerControlsRight} gap="xs" wrap="nowrap">
                <Tooltip label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
                  <ActionIcon
                    aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                    className={styles.headerAction}
                    onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
                    radius="xl"
                    size="lg"
                    variant="default"
                  >
                    {isDark ? <IconSunHigh size={18} /> : <IconMoonStars size={18} />}
                  </ActionIcon>
                </Tooltip>
              </Group>
            </div>
          </div>

          <WarningBanner
            items={score.pending}
            actionLabel={nextIncompleteOnboardingPath ? 'Continue Security Setup' : undefined}
            onAction={nextIncompleteOnboardingPath ? () => navigate(nextIncompleteOnboardingPath) : undefined}
          />
          <Outlet />
        </Stack>
      </div>

      <div className={styles.footerDock}>
        <div className={styles.frame}>
          <BottomTabBar />
        </div>
      </div>
    </div>
  )
}
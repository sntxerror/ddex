import { ActionIcon, Badge, Group, Paper, Progress, Stack, Text, useMantineColorScheme } from '@mantine/core'
import { IconMoonStars, IconSunHigh, IconX } from '@tabler/icons-react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import styles from './OnboardLayout.module.css'
import { useKeystoreStore } from '../stores/keystoreStore'
import { useWalletStore } from '../stores/walletStore'

const stepMap = new Map<string, { readonly index: number; readonly label: string }>([
  ['/welcome', { index: 0, label: 'Welcome' }],
  ['/unlock', { index: 0, label: 'Unlock' }],
  ['/onboard/create', { index: 1, label: 'Create wallet' }],
  ['/onboard/import', { index: 1, label: 'Import wallet' }],
  ['/onboard/backup', { index: 2, label: 'Backup phrase' }],
  ['/onboard/passphrase', { index: 3, label: 'Local passphrase' }],
  ['/onboard/biometrics', { index: 4, label: 'Biometrics' }],
  ['/onboard/complete', { index: 5, label: 'Complete' }],
])

export function OnboardLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const walletAddress = useWalletStore((state) => state.address)
  const step = stepMap.get(pathname) ?? { index: 0, label: 'Welcome' }
  const progress = step.index === 0 ? 0 : (step.index / 5) * 100
  const isDark = colorScheme === 'dark'
  const closeTarget = walletAddress ? '/vault' : storedVault ? '/unlock' : '/welcome'

  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <Stack gap="lg">
          <Group align="flex-start" justify="space-between" wrap="nowrap">
            <Stack gap="xs">
              <Text fw={800} size="xl">{step.label}</Text>
              <Text c="dimmed" size="sm">A guided onboarding flow that offers each security step one-by-one, with a clear explanation before you continue, skip, or close it.</Text>
              <Progress color="cyan" radius="xl" size="sm" value={progress} />
            </Stack>

            <Group gap="xs" wrap="nowrap">
              <ActionIcon
                aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
                radius="xl"
                size="lg"
                variant="default"
              >
                {isDark ? <IconSunHigh size={18} /> : <IconMoonStars size={18} />}
              </ActionIcon>
              {step.index > 0 ? (
                <ActionIcon
                  aria-label="Close onboarding"
                  onClick={() => navigate(closeTarget)}
                  radius="xl"
                  size="lg"
                  variant="default"
                >
                  <IconX size={18} />
                </ActionIcon>
              ) : null}
            </Group>
          </Group>

          <Paper className={styles.panel} p="xl" radius="xl">
            <Outlet />
          </Paper>
        </Stack>
      </div>
    </div>
  )
}
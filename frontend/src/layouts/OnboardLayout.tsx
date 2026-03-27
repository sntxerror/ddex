import { Badge, Paper, Progress, Stack, Text } from '@mantine/core'
import { Outlet, useLocation } from 'react-router'
import styles from './OnboardLayout.module.css'

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
  const { pathname } = useLocation()
  const step = stepMap.get(pathname) ?? { index: 0, label: 'Welcome' }
  const progress = step.index === 0 ? 0 : (step.index / 5) * 100

  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <Stack gap="lg">
          <Stack gap="xs">
            <Badge color="cyan" radius="xl" variant="light">Mobile-first wallet rewrite</Badge>
            <Text fw={800} size="xl">{step.label}</Text>
            <Text c="dimmed" size="sm">A guided setup flow with real routing, local keystore security, and less dashboard soup.</Text>
            <Progress color="cyan" radius="xl" size="sm" value={progress} />
          </Stack>

          <Paper className={styles.panel} p="xl" radius="xl">
            <Outlet />
          </Paper>
        </Stack>
      </div>
    </div>
  )
}
import { Badge, Button, Code, Group, Loader, Paper, Stack, Text } from '@mantine/core'
import { IconShieldCheck, IconStars } from '@tabler/icons-react'
import { Navigate, useNavigate } from 'react-router'
import { useEffect } from 'react'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { getMnemonicWordCount, useWalletStore } from '../../stores/walletStore'
import actionStyles from './OnboardActions.module.css'

export function CreateWalletScreen() {
  const navigate = useNavigate()
  const createWallet = useWalletStore((state) => state.createWallet)
  const feedback = useWalletStore((state) => state.feedback)
  const isWorking = useWalletStore((state) => state.isWorking)
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const wasmStatus = useWalletStore((state) => state.wasmStatus)
  const markWalletPrepared = useOnboardingStore((state) => state.markWalletPrepared)

  useEffect(() => {
    if (wasmStatus !== 'ready' || mnemonic) {
      return
    }

    void createWallet().then((ok) => {
      if (ok) {
        markWalletPrepared(false)
      }
    })
  }, [createWallet, markWalletPrepared, mnemonic, wasmStatus])

  if (wasmStatus === 'error') {
    return <Navigate replace to="/welcome" />
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Badge color="cyan" leftSection={<IconShieldCheck size={14} />} radius="xl" variant="light">2/10</Badge>
        {isWorking ? <Loader color="cyan" size="sm" /> : null}
      </Group>

      <Stack gap="xs">
        <Text fw={800} size="xl">Wallet created locally</Text>
        <Text c="dimmed">We generated a fresh recovery phrase and derived your account key entirely in-browser.</Text>
        <Text c="dimmed" size="sm">Next up: confirm your recovery backup, then set a PIN lock and biometrics for stronger local protection.</Text>
      </Stack>

      <Paper p="lg" radius="xl" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={700}>Recovery phrase preview</Text>
            <Badge radius="xl" variant="outline">{getMnemonicWordCount(mnemonic)} words</Badge>
          </Group>
          <Code block>{mnemonic || 'Generating your wallet phrase…'}</Code>
        </Stack>
      </Paper>

      <Paper p="lg" radius="xl" withBorder>
        <Group align="flex-start" wrap="nowrap">
          <IconStars color="var(--ddex-accent-primary)" size={20} />
          <Text c="dimmed" size="sm">MobileCoin account keys are derived from this phrase, and your primary address is already ready for receive flows.</Text>
        </Group>
      </Paper>

      {feedback ? <Text c="dimmed" size="sm">{feedback}</Text> : null}

      <Group grow>
        <Button className={actionStyles.actionButton} onClick={() => navigate('/welcome')} radius="xl" variant="default">Cancel setup</Button>
        <Button className={actionStyles.actionButton} disabled={!mnemonic} gradient={{ from: 'cyan', to: 'teal', deg: 135 }} onClick={() => navigate('/onboard/backup')} radius="xl" variant="gradient">
          Continue to Backup
        </Button>
      </Group>
    </Stack>
  )
}
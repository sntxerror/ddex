import { Alert, Badge, Button, Group, Stack, Text, Textarea } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { validateMnemonic } from '@ddex/wallet-core-web'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { getMnemonicWordCount, useWalletStore } from '../../stores/walletStore'
import actionStyles from './OnboardActions.module.css'

export function ImportWalletScreen() {
  const navigate = useNavigate()
  const feedback = useWalletStore((state) => state.feedback)
  const deriveWallet = useWalletStore((state) => state.deriveWallet)
  const isWorking = useWalletStore((state) => state.isWorking)
  const mnemonicDraft = useWalletStore((state) => state.mnemonicDraft)
  const setMnemonicDraft = useWalletStore((state) => state.setMnemonicDraft)
  const markWalletPrepared = useOnboardingStore((state) => state.markWalletPrepared)

  const normalizedDraft = useMemo(() => mnemonicDraft.trim().replace(/\s+/g, ' '), [mnemonicDraft])
  const wordCount = getMnemonicWordCount(normalizedDraft)
  const isValid = normalizedDraft.length > 0 && validateMnemonic(normalizedDraft)

  const handleSubmit = async () => {
    const ok = await deriveWallet(normalizedDraft, {
      successMessage: 'Wallet imported locally. Nice rescue operation.',
    })

    if (ok) {
      markWalletPrepared(true)
      navigate('/onboard/backup')
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Recover an existing wallet</Text>
        <Text c="dimmed">Paste your 24-word phrase below. Validation happens locally before anything is derived.</Text>
        <Text c="dimmed" size="sm">After import, we’ll still walk you through backup confirmation, PIN lock setup, and biometrics one step at a time.</Text>
      </Stack>

      <Textarea
        autosize
        label="Recovery phrase"
        minRows={5}
        onChange={(event) => setMnemonicDraft(event.currentTarget.value)}
        placeholder="word1 word2 word3 …"
        radius="xl"
        value={mnemonicDraft}
      />

      <Group justify="space-between">
        <Badge radius="xl" variant="outline">{wordCount} words</Badge>
        <Badge color={isValid ? 'teal' : 'gray'} radius="xl" variant="light">{isValid ? 'Valid mnemonic' : 'Waiting for valid phrase'}</Badge>
      </Group>

      <Alert color="cyan" icon={<IconInfoCircle size={18} />} radius="xl" variant="light">
        DDEX only needs the phrase long enough to derive your account locally. It is not posted anywhere.
      </Alert>

      {feedback ? <Text c="dimmed" size="sm">{feedback}</Text> : null}

      <Group grow>
        <Button className={actionStyles.actionButton} onClick={() => navigate('/welcome')} radius="xl" variant="default">Cancel import</Button>
        <Button className={actionStyles.actionButton} disabled={!isValid || isWorking} gradient={{ from: 'cyan', to: 'teal', deg: 135 }} onClick={() => void handleSubmit()} radius="xl" variant="gradient">
          Import Wallet
        </Button>
      </Group>
    </Stack>
  )
}
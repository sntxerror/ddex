import { Button, Group, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { getNextIncompleteStepFromCurrent, useOnboardingStore } from '../../stores/onboardingStore'
import { useWalletStore } from '../../stores/walletStore'
import actionStyles from './OnboardActions.module.css'

function pickValidationIndices(wordCount: number): [number, number] {
  const first = Math.floor(Math.random() * wordCount)
  let second = Math.floor(Math.random() * wordCount)

  while (second === first) {
    second = Math.floor(Math.random() * wordCount)
  }

  return first < second ? [first, second] : [second, first]
}

export function BackupMnemonicValidationScreen() {
  const navigate = useNavigate()
  const completeMnemonicBackup = useOnboardingStore((state) => state.completeMnemonicBackup)
  const mnemonic = useWalletStore((state) => state.mnemonic)
  const words = useMemo(() => mnemonic.trim().split(/\s+/), [mnemonic])
  const [firstIndex, secondIndex] = useMemo(() => pickValidationIndices(words.length), [words.length])
  const [firstAnswer, setFirstAnswer] = useState('')
  const [secondAnswer, setSecondAnswer] = useState('')
  const [validationError, setValidationError] = useState('')

  if (!mnemonic) {
    return <Navigate replace to="/onboard/create" />
  }

  const normalizedFirstAnswer = firstAnswer.trim().toLowerCase()
  const normalizedSecondAnswer = secondAnswer.trim().toLowerCase()

  const handleConfirm = () => {
    const expectedFirst = words[firstIndex]?.toLowerCase() ?? ''
    const expectedSecond = words[secondIndex]?.toLowerCase() ?? ''

    if (normalizedFirstAnswer !== expectedFirst || normalizedSecondAnswer !== expectedSecond) {
      setValidationError('One or both words do not match your recovery phrase. Review your backup and try again.')
      return
    }

    setValidationError('')
    completeMnemonicBackup()
    const nextPath = getNextIncompleteStepFromCurrent('/onboard/backup', useOnboardingStore.getState())
    navigate(nextPath)
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Confirm your backup</Text>
        <Text c="dimmed">Before we count your recovery phrase as backed up, confirm two random words from it.</Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <TextInput
          onChange={(event) => setFirstAnswer(event.currentTarget.value)}
          placeholder={`Word #${firstIndex + 1}`}
          radius="xl"
          value={firstAnswer}
        />
        <TextInput
          onChange={(event) => setSecondAnswer(event.currentTarget.value)}
          placeholder={`Word #${secondIndex + 1}`}
          radius="xl"
          value={secondAnswer}
        />
      </SimpleGrid>

      {validationError ? <Text c="yellow.3" size="sm">{validationError}</Text> : null}

      <Group grow>
        <Button className={actionStyles.actionButton} onClick={() => navigate('/onboard/backup')} radius="xl" variant="default">
          Review Phrase Again
        </Button>
        <Button
          className={actionStyles.actionButton}
          disabled={!normalizedFirstAnswer || !normalizedSecondAnswer}
          gradient={{ from: 'cyan', to: 'teal', deg: 135 }}
          onClick={handleConfirm}
          radius="xl"
          variant="gradient"
        >
          Confirm Backup
        </Button>
      </Group>
    </Stack>
  )
}

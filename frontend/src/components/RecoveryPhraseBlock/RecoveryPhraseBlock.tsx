import { ActionIcon, Code, Tooltip } from '@mantine/core'
import { IconCopy } from '@tabler/icons-react'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import styles from './RecoveryPhraseBlock.module.css'

interface RecoveryPhraseBlockProps {
  readonly copyId: string
  readonly mnemonic: string
}

function formatRecoveryPhrase(mnemonic: string): string {
  const words = mnemonic.trim().split(/\s+/)
  const entries = words.map((word, index) => `${index + 1}. ${word}`)
  const columnsPerRow = 3
  const rows: string[][] = []

  for (let index = 0; index < entries.length; index += columnsPerRow) {
    rows.push(entries.slice(index, index + columnsPerRow))
  }

  const columnWidth = Math.max(...entries.map((entry) => entry.length)) + 4

  return rows
    .map((row) => row.map((entry) => entry.padEnd(columnWidth)).join('').trimEnd())
    .join('\n')
}

export function RecoveryPhraseBlock({ copyId, mnemonic }: RecoveryPhraseBlockProps) {
  const { copiedKey, copyText } = useCopyFeedback()
  const normalizedMnemonic = mnemonic.trim().replace(/\s+/g, ' ')
  const formattedPhrase = formatRecoveryPhrase(normalizedMnemonic)

  const copyPhrase = async () => {
    await copyText(copyId, normalizedMnemonic)
  }

  return (
    <div className={styles.root}>
      <Tooltip disabled={copiedKey !== copyId} label="Copied" opened={copiedKey === copyId} position="top" withArrow>
        <ActionIcon
          aria-label="Copy recovery phrase"
          className={styles.copyButton}
          onClick={() => void copyPhrase()}
          radius="xl"
          variant="default"
        >
          <IconCopy size={16} />
        </ActionIcon>
      </Tooltip>

      <Code block className={styles.code}>
        {formattedPhrase}
      </Code>
    </div>
  )
}

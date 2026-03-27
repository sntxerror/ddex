import { ActionIcon, TextInput, type TextInputProps } from '@mantine/core'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import { useState, type ChangeEvent } from 'react'
import styles from './PinInputField.module.css'

interface PinInputFieldProps extends Omit<TextInputProps, 'classNames' | 'leftSection' | 'leftSectionPointerEvents' | 'leftSectionWidth' | 'rightSection' | 'rightSectionPointerEvents' | 'rightSectionWidth' | 'type'> {
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export function PinInputField({
  onChange,
  ...props
}: PinInputFieldProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <TextInput
      {...props}
      autoCapitalize="off"
      autoCorrect="off"
      classNames={{
        input: `${styles.input} ${!revealed ? styles.inputMasked : ''}`.trim(),
        section: styles.section,
      }}
      leftSection={<span aria-hidden="true" className={styles.spacer} />}
      leftSectionPointerEvents="none"
      leftSectionWidth={56}
      onChange={onChange}
      rightSection={
        <ActionIcon
          aria-label={revealed ? 'Hide PIN code' : 'Show PIN code'}
          className={styles.visibilityButton}
          onClick={() => setRevealed((value) => !value)}
          radius="xl"
          size="sm"
          variant="subtle"
        >
          {revealed ? <IconEyeOff size={20} stroke={1.9} /> : <IconEye size={20} stroke={1.9} />}
        </ActionIcon>
      }
      rightSectionPointerEvents="all"
      rightSectionWidth={56}
      spellCheck={false}
      type="text"
    />
  )
}

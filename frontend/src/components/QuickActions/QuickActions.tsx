import { Paper, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconArrowsShuffle, IconArrowUpRight, IconDownload } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import styles from './QuickActions.module.css'

export function QuickActions() {
  const navigate = useNavigate()

  const items = [
    {
      icon: IconDownload,
      label: 'Receive',
      onClick: () => navigate('/transfer/receive'),
    },
    {
      icon: IconArrowUpRight,
      label: 'Send',
      onClick: () => navigate('/transfer'),
    },
    {
      icon: IconArrowsShuffle,
      label: 'Swap',
      onClick: undefined,
    },
  ] as const

  return (
    <SimpleGrid className={styles.actions} cols={3} spacing="sm">
      {items.map((item) => {
        const Icon = item.icon

        return (
          <Paper
            className={styles.action}
            key={item.label}
            p={0}
            radius="xl"
            withBorder
          >
            <button
              className={styles.button}
              disabled={!item.onClick}
              onClick={item.onClick}
              type="button"
            >
              <Stack align="center" className={styles.content} gap="sm">
                <ThemeIcon className={styles.icon} color="cyan" radius="xl" size="xl" variant="light">
                  <Icon size={18} />
                </ThemeIcon>
                <Text fw={700} size="md">{item.label}</Text>
              </Stack>
            </button>
          </Paper>
        )
      })}
    </SimpleGrid>
  )
}
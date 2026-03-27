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
            p="md"
            radius="xl"
            withBorder
          >
            <button
              disabled={!item.onClick}
              onClick={item.onClick}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 0,
                color: 'inherit',
                cursor: item.onClick ? 'pointer' : 'not-allowed',
                display: 'block',
                font: 'inherit',
                padding: 0,
                width: '100%',
              }}
              type="button"
            >
              <Stack align="center" gap="xs">
                <ThemeIcon color="cyan" radius="xl" size="lg" variant="light">
                  <Icon size={18} />
                </ThemeIcon>
                <Text fw={700} size="sm">{item.label}</Text>
              </Stack>
            </button>
          </Paper>
        )
      })}
    </SimpleGrid>
  )
}
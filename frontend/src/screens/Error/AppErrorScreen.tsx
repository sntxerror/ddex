import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh, IconRoute } from '@tabler/icons-react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router'

function getErrorDetails(error: unknown): { message: string; title: string } {
  if (isRouteErrorResponse(error)) {
    return {
      message: typeof error.data === 'string' ? error.data : error.statusText,
      title: `Route error ${error.status}`,
    }
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      title: 'Unexpected application error',
    }
  }

  return {
    message: 'Something went wrong while rendering this screen.',
    title: 'Unexpected application error',
  }
}

export function AppErrorScreen() {
  const error = useRouteError()
  const navigate = useNavigate()
  const { message, title } = getErrorDetails(error)

  return (
    <Stack align="center" justify="center" mih="100dvh" p="lg">
      <Paper maw={640} p="xl" radius="xl" w="100%" withBorder>
        <Stack gap="lg">
          <Group justify="space-between">
            <Text fw={900} size="xl">{title}</Text>
            <IconRoute color="var(--ddex-accent-primary)" size={24} />
          </Group>

          <Text c="dimmed">
            The app hit a rendering problem.
          </Text>

          <Alert color="red" icon={<IconAlertTriangle size={18} />} radius="xl" title="What happened" variant="light">
            <Text size="sm">{message}</Text>
          </Alert>

          <Group>
            <Button leftSection={<IconRefresh size={16} />} onClick={() => window.location.reload()} radius="xl" variant="gradient" gradient={{ from: 'cyan', to: 'teal', deg: 135 }}>
              Reload app
            </Button>
            <Button onClick={() => navigate('/welcome')} radius="xl" variant="default">
              Back to welcome
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  )
}
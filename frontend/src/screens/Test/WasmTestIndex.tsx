import { Paper, Stack, Text, Button, SimpleGrid } from '@mantine/core'
import { IconKey, IconTransferOut, IconSwitch3 } from '@tabler/icons-react'
import { useNavigate } from 'react-router'

export function WasmTestIndex() {
  const navigate = useNavigate()

  return (
    <Stack p="xl" gap="md">
      <Text size="xl" fw={700}>
        WASM Test Suite
      </Text>
      <Text c="dimmed">
        Test MobileCoin WASM bindings for key generation, transaction building, and SCI atomic swaps.
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mt="md">
        <Paper p="md" withBorder>
          <Stack gap="md">
            <IconKey size={32} />
            <Text fw={600}>Key Generation</Text>
            <Text size="sm" c="dimmed">
              Test mnemonic generation, key derivation, and address encoding.
            </Text>
            <Button onClick={() => navigate('/debug/wasm/keys')} variant="light">
              Run Test
            </Button>
          </Stack>
        </Paper>

        <Paper p="md" withBorder>
          <Stack gap="md">
            <IconTransferOut size={32} />
            <Text fw={600}>Transaction Build</Text>
            <Text size="sm" c="dimmed">
              Test building transactions with fixture data and key images.
            </Text>
            <Button onClick={() => navigate('/debug/wasm/tx')} variant="light">
              Run Test
            </Button>
          </Stack>
        </Paper>

        <Paper p="md" withBorder>
          <Stack gap="md">
            <IconSwitch3 size={32} />
            <Text fw={600}>SCI Atomic Swap</Text>
            <Text size="sm" c="dimmed">
              Test signed contingent inputs, serialization, and swap validation.
            </Text>
            <Button onClick={() => navigate('/debug/wasm/sci')} variant="light">
              Run Test
            </Button>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  )
}

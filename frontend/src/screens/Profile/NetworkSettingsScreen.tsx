import { Alert, Button, Radio, RadioGroup, Stack, Text } from '@mantine/core'
import { useNavigate } from 'react-router'
import { useNetworkStore } from '../../stores/networkStore'

export function NetworkSettingsScreen() {
  const navigate = useNavigate()
  const network = useNetworkStore((state) => state.network)
  const setNetwork = useNetworkStore((state) => state.setNetwork)

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={800} size="xl">Network Settings</Text>
        <Text c="dimmed">Mainnet is present as a shell option for future work; testnet remains the active development lane.</Text>
      </Stack>

      <RadioGroup onChange={(value) => setNetwork(value as 'testnet' | 'mainnet')} value={network}>
        <Stack gap="sm">
          <Radio label="Testnet" value="testnet" />
          <Radio label="Mainnet" value="mainnet" />
        </Stack>
      </RadioGroup>

      <Alert color="cyan" radius="xl" variant="light">
        Switching the shell theme is real today; switching live chain connectivity is still roadmap territory.
      </Alert>

      <Button onClick={() => navigate('/profile')} radius="xl" variant="default">Back to Profile</Button>
    </Stack>
  )
}
import { Paper, Stack, Text, Loader, Alert } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import {
  generateMnemonic,
  validateMnemonic,
  accountKeyFromMnemonic,
  deriveSubaddress,
  getAddressForAccount,
  type WalletAccountKey,
  type DerivedSubaddress,
} from '@ddex/wallet-core-web'

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface TestResult {
  mnemonic: string
  isValidMnemonic: boolean
  privateKeys: WalletAccountKey
  publicKey: DerivedSubaddress
  address: string
}

export function WasmKeysTest() {
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function runTest() {
      try {
        const mnemonic = await generateMnemonic()
        const isValidMnemonic = validateMnemonic(mnemonic)
        const privateKeys = await accountKeyFromMnemonic(mnemonic, '', new Uint8Array([]))
        const publicKey = await deriveSubaddress(privateKeys, 0n)
        const address = await getAddressForAccount(privateKeys)

        setResult({
          mnemonic,
          isValidMnemonic,
          privateKeys,
          publicKey,
          address,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    runTest()
  }, [])

  if (loading) {
    return (
      <Stack align="center" justify="center" h="100%">
        <Loader size="xl" />
        <Text>Testing key generation...</Text>
      </Stack>
    )
  }

  if (error) {
    return (
      <Stack p="xl">
        <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red">
          {error}
        </Alert>
      </Stack>
    )
  }

  if (!result) {
    return null
  }

  return (
    <Stack p="xl" gap="md">
      <Text size="xl" fw={700}>
        Key Generation Test
      </Text>

      <Paper p="md" withBorder>
        <Stack gap="xs">
          <Text fw={600}>Mnemonic Generation</Text>
          <Text size="sm" c="dimmed">
            Mnemonic: {result.mnemonic}
          </Text>
          <Text size="sm" c="dimmed">
            Is Valid: {result.isValidMnemonic ? 'Yes' : 'No'}
          </Text>
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="xs">
          <Text fw={600}>Account Keys</Text>
          <Text size="xs" c="dimmed">
            View Private Key: {bytesToHex(result.privateKeys.view_private_key)}
          </Text>
          <Text size="xs" c="dimmed">
            Spend Private Key: {bytesToHex(result.privateKeys.spend_private_key)}
          </Text>
          <Text size="xs" c="dimmed">
            View Public Key: {bytesToHex(result.publicKey.view_public_key)}
          </Text>
          <Text size="xs" c="dimmed">
            Spend Public Key: {bytesToHex(result.publicKey.spend_public_key)}
          </Text>
          <Text size="xs" c="dimmed">
            Subaddress Index: {result.publicKey.subaddress_index}
          </Text>
          <Text size="xs" c="dimmed">
            Address (b58): {result.address}
          </Text>
        </Stack>
      </Paper>
    </Stack>
  )
}

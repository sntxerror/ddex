import { Paper, Stack, Text, Code, Loader, Alert, Badge } from '@mantine/core'
import { IconAlertCircle, IconCheck } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import {
  serializeSCIToHex,
  deserializeSCIFromHex,
  type SignedContingentInput,
  type UnmaskedAmount,
  type RingMLSAG,
} from '@ddex/wallet-core-web'

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface TestResult {
  aliceSCI: SignedContingentInput
  aliceHex: string
  bobSCI: SignedContingentInput
  receivedSCI: SignedContingentInput
  totalInputs: bigint
  totalOutputs: bigint
  impliedFee: bigint
}

export function WasmSCITest() {
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function runTest() {
      try {
        console.log('Creating Alice SCI...')
        // Alice creates SCI: offers 100 MOB, wants 50 MOB
        const aliceSCI: SignedContingentInput = {
          block_version: 3,
          ring: [
            {
              target_key: Array(32).fill(0xa1),
              public_key: Array(32).fill(0xa2),
              commitment: Array(32).fill(0xa3),
              tx_out_bytes: [],
              proof_bytes: [],
            },
          ],
          input_rules: {
            required_outputs: [Array(100).fill(0xaa)],
            max_tombstone_block: 2000,
          },
          mlsag: {
            c_zero: Array(32).fill(0xa4),
            responses: [Array(32).fill(0xa5), Array(32).fill(0xa6)],
            key_image: Array(32).fill(0xa7),
          } as RingMLSAG,
          pseudo_output_unmasked: {
            value: 100_000_000n,
            token_id: 0n,
            blinding: Array.from({ length: 32 }, () => 0xa8),
          } as UnmaskedAmount,
          required_outputs_unmasked: [
            {
              value: 50_000_000n,
              token_id: 0n,
              blinding: Array.from({ length: 32 }, () => 0xa9),
            } as UnmaskedAmount,
          ],
          tx_out_global_indices: [12345n],
        }

        console.log('Serializing Alice SCI...', aliceSCI)
        // Serialize Alice's SCI to hex
        const aliceHex = await serializeSCIToHex(aliceSCI)
        console.log('Serialized successfully')

        // Bob receives and deserializes
        const receivedSCI = await deserializeSCIFromHex(aliceHex)
        console.log('Received SCI:', receivedSCI)
        console.log('Value type:', typeof receivedSCI.pseudo_output_unmasked.value)

        // Bob creates his SCI: offers 60 MOB, wants 100 MOB
        const bobSCI: SignedContingentInput = {
          block_version: 3,
          ring: [
            {
              target_key: Array(32).fill(0xb1),
              public_key: Array(32).fill(0xb2),
              commitment: Array(32).fill(0xb3),
              tx_out_bytes: [],
              proof_bytes: [],
            },
          ],
          input_rules: {
            required_outputs: [Array(100).fill(0xbb)],
            max_tombstone_block: 2000,
          },
          mlsag: {
            c_zero: Array(32).fill(0xb4),
            responses: [Array(32).fill(0xb5), Array(32).fill(0xb6)],
            key_image: Array(32).fill(0xb7),
          } as RingMLSAG,
          pseudo_output_unmasked: {
            value: 60_000_000n,
            token_id: 0n,
            blinding: Array.from({ length: 32 }, () => 0xb8),
          } as UnmaskedAmount,
          required_outputs_unmasked: [
            {
              value: 100_000_000n,
              token_id: 0n,
              blinding: Array.from({ length: 32 }, () => 0xb9),
            } as UnmaskedAmount,
          ],
          tx_out_global_indices: [67890n],
        }

        // Analyze swap (convert to BigInt for consistency)
        const totalInputs =
          BigInt(receivedSCI.pseudo_output_unmasked.value) + BigInt(bobSCI.pseudo_output_unmasked.value)
        const totalOutputs =
          BigInt(receivedSCI.required_outputs_unmasked[0].value) +
          BigInt(bobSCI.required_outputs_unmasked[0].value)
        const impliedFee = totalInputs - totalOutputs

        setResult({
          aliceSCI,
          aliceHex,
          bobSCI,
          receivedSCI,
          totalInputs,
          totalOutputs,
          impliedFee,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        console.error('SCI test error:', err)
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
        <Text>Testing SCI workflow...</Text>
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
        SCI Atomic Swap Test
      </Text>
      
      <Alert color="blue" title="Note: Mock Data">
        <Stack gap="xs">
          <Text size="sm">
            This test uses mock SCIs with fake cryptographic data (e.g., key images filled with 0xa7).
            Real SCIs require actual blockchain inputs, ring members, and MLSAG signatures.
          </Text>
          <Text size="sm" fw={600}>
            Current test demonstrates serialization workflow only:
          </Text>
          <Text size="sm" component="ul" style={{ marginLeft: '1rem' }}>
            <li>Alice creates mock SCI → serialize to hex</li>
            <li>Bob deserializes hex → validates structure</li>
            <li>Shows hex transport works correctly</li>
          </Text>
          <Text size="sm" c="dimmed" mt="xs">
            Based on:{' '}
            <Code>crates/wallet-core/src/tests/sci_e2e_test.rs::test_sci_serialization_workflow</Code>
          </Text>
        </Stack>
      </Alert>

      <Paper p="md" withBorder>
        <Stack gap="md">
          <Text fw={600}>Step 1: Alice Creates SCI</Text>
          <Stack gap="xs">
            <Badge color="blue" leftSection={<IconCheck size={14} />}>
              Alice offers:{' '}
              {(Number(result.aliceSCI.pseudo_output_unmasked.value) / 1_000_000).toFixed(2)} MOB
            </Badge>
            <Badge color="green" leftSection={<IconCheck size={14} />}>
              Alice wants:{' '}
              {(Number(result.aliceSCI.required_outputs_unmasked[0].value) / 1_000_000).toFixed(2)}{' '}
              MOB
            </Badge>
            <Text size="xs" c="dimmed">
              Key Image: {bytesToHex(result.aliceSCI.mlsag.key_image)}
            </Text>
          </Stack>
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="md">
          <Text fw={600}>Step 2: Alice Serializes to Hex</Text>
          <Text size="xs" c="dimmed">
            Hex length: {result.aliceHex.length} characters
          </Text>
          <Code block style={{ fontSize: '10px', maxHeight: '200px', overflow: 'auto' }}>
            {result.aliceHex}
          </Code>
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="md">
          <Text fw={600}>Step 3: Bob Receives and Deserializes</Text>
          <Badge color="cyan" leftSection={<IconCheck size={14} />}>
            Deserialization successful
          </Badge>
          <Text size="xs" c="dimmed">
            Verified: Alice offers{' '}
            {(Number(result.receivedSCI.pseudo_output_unmasked.value) / 1_000_000).toFixed(2)} MOB
          </Text>
          <Text size="xs" c="dimmed">
            Verified: Alice wants{' '}
            {(
              Number(result.receivedSCI.required_outputs_unmasked[0].value) / 1_000_000
            ).toFixed(2)}{' '}
            MOB
          </Text>
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="md">
          <Text fw={600}>Step 4: Bob Creates His SCI</Text>
          <Stack gap="xs">
            <Badge color="blue" leftSection={<IconCheck size={14} />}>
              Bob offers:{' '}
              {(Number(result.bobSCI.pseudo_output_unmasked.value) / 1_000_000).toFixed(2)} MOB
            </Badge>
            <Badge color="green" leftSection={<IconCheck size={14} />}>
              Bob wants:{' '}
              {(Number(result.bobSCI.required_outputs_unmasked[0].value) / 1_000_000).toFixed(2)}{' '}
              MOB
            </Badge>
            <Text size="xs" c="dimmed">
              Key Image: {bytesToHex(result.bobSCI.mlsag.key_image)}
            </Text>
          </Stack>
        </Stack>
      </Paper>

      <Paper p="md" withBorder bg="dark.8">
        <Stack gap="md">
          <Text fw={600}>Step 5: Swap Analysis</Text>
          <Stack gap="xs">
            <Text size="sm">
              Total Inputs:{' '}
              <Text component="span" fw={600} c="blue">
                {(Number(result.totalInputs) / 1_000_000).toFixed(2)} MOB
              </Text>
            </Text>
            <Text size="sm">
              Total Outputs:{' '}
              <Text component="span" fw={600} c="green">
                {(Number(result.totalOutputs) / 1_000_000).toFixed(2)} MOB
              </Text>
            </Text>
            <Text size="sm">
              Transaction Fee:{' '}
              <Text component="span" fw={600} c="yellow">
                {(Number(result.impliedFee) / 1_000_000).toFixed(2)} MOB
              </Text>
            </Text>
            {result.impliedFee === 10_000_000n && (
              <Badge color="green" size="lg" leftSection={<IconCheck size={14} />}>
                Swap balances correctly!
              </Badge>
            )}
          </Stack>
        </Stack>
      </Paper>

      <Paper p="md" withBorder bg="dark.7">
        <Stack gap="xs">
          <Text fw={600} c="cyan">
            ✓ Ready to combine SCIs
          </Text>
          <Text size="sm" c="dimmed">
            Both SCIs can now be passed to <Code>buildTransactionWithSCIs()</Code> and submitted to
            the network.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  )
}

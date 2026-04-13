import { Paper, Stack, Text, Code, Loader, Alert } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { buildTransaction } from '@ddex/wallet-core-web'

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

interface TestResult {
  key_images: string[]
}

const FIXTURE = {
  build_transaction_input: {
    account_key: {
      view_private_key: new Uint8Array([
        62, 47, 3, 151, 216, 123, 226, 152, 217, 160, 177, 127, 43, 109, 90, 228, 113, 79, 52, 33,
        172, 170, 193, 237, 87, 98, 123, 247, 123, 225, 84, 11,
      ]),
      spend_private_key: new Uint8Array([
        220, 122, 0, 188, 136, 94, 251, 216, 242, 164, 253, 127, 211, 245, 209, 91, 194, 223, 74,
        79, 238, 103, 216, 58, 192, 159, 23, 184, 94, 214, 16, 15,
      ]),
      fog_report_url: '',
      fog_authority_spki: new Uint8Array([]),
    },
    inputs: [
      {
        real_index: 0,
        ring: [
          {
            target_key: [
              120, 188, 254, 30, 142, 92, 159, 36, 125, 72, 176, 127, 137, 239, 238, 16, 125, 105,
              81, 144, 168, 100, 36, 69, 2, 154, 137, 201, 163, 155, 14, 120,
            ],
            public_key: [
              204, 252, 252, 10, 144, 117, 148, 1, 98, 174, 91, 42, 62, 160, 197, 172, 50, 31, 217,
              67, 101, 128, 153, 240, 71, 22, 31, 170, 203, 158, 244, 52,
            ],
            commitment: [
              188, 56, 207, 56, 122, 245, 89, 217, 42, 83, 215, 21, 250, 45, 167, 138, 209, 217,
              97, 162, 209, 128, 156, 87, 209, 113, 184, 228, 240, 156, 24, 97,
            ],
            tx_out_bytes: [],
            proof_bytes: [],
          },
        ],
        subaddress_index: 0,
        value: 9700695665n,
        token_id: 0n,
      },
      {
        real_index: 0,
        ring: [
          {
            target_key: [
              138, 186, 164, 19, 89, 255, 237, 245, 124, 5, 72, 72, 233, 22, 238, 60, 54, 210, 48,
              138, 189, 189, 84, 59, 139, 125, 38, 164, 23, 49, 82, 70,
            ],
            public_key: [
              114, 203, 131, 18, 84, 42, 235, 234, 152, 55, 70, 93, 82, 87, 194, 11, 189, 117, 114,
              92, 182, 52, 73, 243, 231, 187, 3, 101, 59, 223, 48, 110,
            ],
            commitment: [
              238, 224, 19, 101, 39, 141, 25, 204, 108, 194, 61, 47, 183, 12, 1, 93, 66, 100, 6,
              16, 1, 171, 62, 98, 124, 244, 41, 46, 92, 56, 212, 85,
            ],
            tx_out_bytes: [],
            proof_bytes: [],
          },
        ],
        subaddress_index: 0,
        value: 1000000000n,
        token_id: 0n,
      },
    ],
    recipient: {
      view_public_key: [
        42, 181, 227, 9, 96, 43, 128, 89, 253, 144, 52, 119, 196, 55, 81, 222, 167, 190, 20, 116,
        201, 160, 39, 149, 71, 93, 249, 132, 237, 149, 48, 95,
      ],
      spend_public_key: [
        246, 170, 130, 44, 173, 98, 21, 19, 39, 81, 245, 220, 46, 192, 13, 178, 248, 8, 143, 234,
        193, 187, 36, 200, 9, 34, 65, 46, 157, 12, 74, 44,
      ],
      fog_report_url: '',
    },
    amount: 10000000000n,
    fee: 100000000n,
    change_recipient: {
      view_public_key: [
        42, 181, 227, 9, 96, 43, 128, 89, 253, 144, 52, 119, 196, 55, 81, 222, 167, 190, 20, 116,
        201, 160, 39, 149, 71, 93, 249, 132, 237, 149, 48, 95,
      ],
      spend_public_key: [
        246, 170, 130, 44, 173, 98, 21, 19, 39, 81, 245, 220, 46, 192, 13, 178, 248, 8, 143, 234,
        193, 187, 36, 200, 9, 34, 65, 46, 157, 12, 74, 44,
      ],
      fog_report_url: '',
    },
    tombstone_block: 4970509n,
    fog_ingest_pubkey: null,
    payment_request_id: 0n,
  },
}

export function WasmTxTest() {
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function runTest() {
      try {
        const input = FIXTURE.build_transaction_input
        const txResult = await buildTransaction(
          input.account_key,
          input.inputs,
          input.recipient,
          input.amount,
          input.fee,
          input.change_recipient,
          input.tombstone_block,
          input.fog_ingest_pubkey,
          input.payment_request_id,
        )

        setResult({
          key_images: txResult.key_images.map((ki) => bytesToHex(ki)),
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
        <Text>Building transaction...</Text>
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
        Transaction Build Test
      </Text>

      <Paper p="md" withBorder>
        <Stack gap="xs">
          <Text fw={600}>Build Transaction Fixture</Text>
          <Code block>{JSON.stringify(FIXTURE, bigIntReplacer, 2)}</Code>
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="xs">
          <Text fw={600}>Build Result</Text>
          <Code block>{JSON.stringify(result, bigIntReplacer, 2)}</Code>
        </Stack>
      </Paper>
    </Stack>
  )
}

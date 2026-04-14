import {
  Paper,
  Stack,
  Text,
  Loader,
  Alert,
  Badge,
  Button,
  Textarea,
  NumberInput,
  Group,
  Divider,
  Progress,
} from '@mantine/core'
import { IconAlertCircle, IconCheck, IconPlayerPlay, IconRefresh } from '@tabler/icons-react'
import { useState, useCallback, useRef } from 'react'
import {
  accountKeyFromMnemonic,
  deriveSubaddress,
  getAddressForAccount,
  createSignedContingentInput,
  buildTxOut,
  fillSCITransaction,
  type OwnedTxOutInput,
  type RingMember,
  type Recipient,
  type SignedContingentInput,
  type BuiltTxOut,
  type TxBuildResult,
} from '@ddex/wallet-core-web'
import { syncFogBalance, type OwnedTxOut, type FogSyncProgress } from '../../services/fogClient'
import {
  getNetworkStatus,
  getMerkleProofs,
  getRingSamples,
  submitTransaction,
  getFogIngestPubkey,
  RING_SIZE,
  MINIMUM_FEE,
  TOMBSTONE_OFFSET,
  type MerkleProofResult,
} from '../../services/consensusClient'
import { FOG_CONFIG } from '../../config'

// ── Helpers ──

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function picoToMob(pico: bigint): string {
  return (Number(pico) / 1e12).toFixed(4)
}

// ── Types ──

type TestPhase =
  | 'idle'
  | 'deriving-keys'
  | 'syncing-alice'
  | 'syncing-bob'
  | 'fetching-network'
  | 'building-alice-ring'
  | 'building-alice-required-output'
  | 'creating-sci'
  | 'building-bob-ring'
  | 'filling-sci'
  | 'submitting'
  | 'waiting'
  | 'resyncing-alice'
  | 'resyncing-bob'
  | 'done'
  | 'error'

interface StepStatus {
  phase: TestPhase
  detail: string
  timestamp: number
}

interface BalanceSnapshot {
  total: bigint
  spendableCount: number
  txOuts: OwnedTxOut[]
}

interface TestState {
  phase: TestPhase
  steps: StepStatus[]
  error?: string
  // Keys
  aliceAddress?: string
  bobAddress?: string
  // Balances
  aliceBalanceBefore?: BalanceSnapshot
  bobBalanceBefore?: BalanceSnapshot
  aliceBalanceAfter?: BalanceSnapshot
  bobBalanceAfter?: BalanceSnapshot
  // SCI
  sciKeyImage?: string
  sciInputValue?: bigint
  sciRequiredOutputValue?: bigint
  // Transaction
  txPrefixHash?: string
  keyImages?: string[]
  submitResult?: string
  blockCount?: string
}

// ── Ring construction (reuses txBuilder.ts pattern) ──

async function buildRingForInput(
  realTxOut: OwnedTxOut,
  globalTxoCount: bigint,
  excludeIndices: Set<string>,
): Promise<{ ring: RingMember[]; realIndex: number; globalIndices: bigint[] }> {
  const { proofs } = await getMerkleProofs([BigInt(realTxOut.globalIndex)])
  const realProof = proofs[0]
  if (!realProof) throw new Error(`No merkle proof for index ${realTxOut.globalIndex}`)

  const decoyCount = RING_SIZE - 1
  const excludeSet = new Set(excludeIndices)
  excludeSet.add(realTxOut.globalIndex)
  const decoys = await getRingSamples(decoyCount, globalTxoCount, excludeSet)

  if (decoys.length < decoyCount) {
    throw new Error(`Not enough decoys: got ${decoys.length}, need ${decoyCount}`)
  }

  const allMembers: { proof: MerkleProofResult; isReal: boolean }[] = [
    { proof: realProof, isReal: true },
    ...decoys.map((d) => ({ proof: d, isReal: false })),
  ]

  // Sort by public_key (MobileCoin consensus requirement)
  allMembers.sort((a, b) => {
    const aPk = a.proof.txOut.public_key
    const bPk = b.proof.txOut.public_key
    for (let i = 0; i < 32; i++) {
      if (aPk[i] !== bPk[i]) return aPk[i] - bPk[i]
    }
    return 0
  })

  const realIndex = allMembers.findIndex((m) => m.isReal)

  const ring: RingMember[] = allMembers.map((m) => ({
    target_key: m.proof.txOut.target_key,
    public_key: m.proof.txOut.public_key,
    commitment: m.proof.txOut.commitment,
    tx_out_bytes: Array.from(m.proof.txOutBytes),
    proof_bytes: Array.from(m.proof.proofBytes),
  }))

  const globalIndices: bigint[] = allMembers.map((m) => BigInt(m.proof.index))

  return { ring, realIndex, globalIndices }
}

// ── Main Component ──

export function WasmSCIE2ETest() {
  const [aliceMnemonic, setAliceMnemonic] = useState('')
  const [bobMnemonic, setBobMnemonic] = useState('')
  const [swapValue, setSwapValue] = useState<number>(500_000_000_000) // 0.5 MOB in picoMOB
  const [state, setState] = useState<TestState>({ phase: 'idle', steps: [] })
  const abortRef = useRef<AbortController | null>(null)

  const addStep = useCallback((phase: TestPhase, detail: string) => {
    const step: StepStatus = { phase, detail, timestamp: Date.now() }
    setState((prev) => ({
      ...prev,
      phase,
      steps: [...prev.steps, step],
    }))
    console.log(`[SCI-E2E] ${phase}: ${detail}`)
  }, [])

  const runTest = useCallback(async () => {
    if (!aliceMnemonic.trim() || !bobMnemonic.trim()) {
      setState({ phase: 'error', steps: [], error: 'Both mnemonics are required' })
      return
    }

    abortRef.current = new AbortController()
    setState({ phase: 'deriving-keys', steps: [] })

    try {
      // ── Phase 1: Derive keys ──
      addStep('deriving-keys', 'Deriving account keys from mnemonics...')

      const aliceKey = await accountKeyFromMnemonic(
        aliceMnemonic.trim(),
        FOG_CONFIG.fogReportUrl,
        FOG_CONFIG.fogAuthoritySpki,
      )
      const aliceAddress = await getAddressForAccount(aliceKey)

      const bobKey = await accountKeyFromMnemonic(
        bobMnemonic.trim(),
        FOG_CONFIG.fogReportUrl,
        FOG_CONFIG.fogAuthoritySpki,
      )
      const bobAddress = await getAddressForAccount(bobKey)
      const bobSubaddr1 = await deriveSubaddress(bobKey, 1n)

      setState((prev) => ({ ...prev, aliceAddress, bobAddress }))
      addStep('deriving-keys', `Alice: ${aliceAddress.slice(0, 20)}... Bob: ${bobAddress.slice(0, 20)}...`)

      // ── Phase 2: Sync Alice's balance ──
      addStep('syncing-alice', 'Syncing Alice\'s balance via Fog...')
      const aliceSync = await syncFogBalance(aliceKey, (p: FogSyncProgress) => {
        console.log(`[SCI-E2E] Alice fog: ${p.phase} ${p.detail ?? ''}`)
      })
      const aliceSpendable = aliceSync.ownedTxOuts.filter((t) => !t.spent && t.tokenId === 0n)
      const aliceBalance: BalanceSnapshot = {
        total: aliceSync.totalBalance,
        spendableCount: aliceSpendable.length,
        txOuts: aliceSync.ownedTxOuts,
      }
      setState((prev) => ({ ...prev, aliceBalanceBefore: aliceBalance }))
      addStep(
        'syncing-alice',
        `Alice balance: ${picoToMob(aliceSync.totalBalance)} MOB (${aliceSpendable.length} UTXOs)`,
      )

      // ── Phase 3: Sync Bob's balance ──
      addStep('syncing-bob', 'Syncing Bob\'s balance via Fog...')
      const bobSync = await syncFogBalance(bobKey, (p: FogSyncProgress) => {
        console.log(`[SCI-E2E] Bob fog: ${p.phase} ${p.detail ?? ''}`)
      })
      const bobSpendable = bobSync.ownedTxOuts.filter((t) => !t.spent && t.tokenId === 0n)
      const bobBalance: BalanceSnapshot = {
        total: bobSync.totalBalance,
        spendableCount: bobSpendable.length,
        txOuts: bobSync.ownedTxOuts,
      }
      setState((prev) => ({ ...prev, bobBalanceBefore: bobBalance }))
      addStep(
        'syncing-bob',
        `Bob balance: ${picoToMob(bobSync.totalBalance)} MOB (${bobSpendable.length} UTXOs)`,
      )

      // ── Validate balances ──
      const swapBigInt = BigInt(swapValue)
      const fee = MINIMUM_FEE

      // Alice needs a TxOut worth at least swapValue (she'll offer it, get back value - swap)
      const aliceTxOut = aliceSpendable.find((t) => t.value > swapBigInt)
      if (!aliceTxOut) {
        throw new Error(
          `Alice needs a single UTXO > ${picoToMob(swapBigInt)} MOB. Largest: ${aliceSpendable.length > 0 ? picoToMob(aliceSpendable.sort((a, b) => (b.value > a.value ? 1 : -1))[0].value) : '0'} MOB`,
        )
      }

      // Bob needs a TxOut worth at least fee
      const bobTxOut = bobSpendable.find((t) => t.value >= fee)
      if (!bobTxOut) {
        throw new Error(
          `Bob needs a UTXO >= ${picoToMob(fee)} MOB for fee. Available: ${bobSpendable.length} UTXOs`,
        )
      }

      addStep(
        'syncing-bob',
        `Selected: Alice UTXO=${picoToMob(aliceTxOut.value)} MOB, Bob UTXO=${picoToMob(bobTxOut.value)} MOB`,
      )

      // ── Phase 4: Fetch network status ──
      addStep('fetching-network', 'Fetching block height and fog report...')
      const networkStatus = await getNetworkStatus()
      const tombstoneBlock = networkStatus.blockHeight + TOMBSTONE_OFFSET
      const fogIngestPubkey = await getFogIngestPubkey()
      addStep(
        'fetching-network',
        `Block height: ${networkStatus.blockHeight}, tombstone: ${tombstoneBlock}`,
      )

      // ── Phase 5: Build Alice's ring ──
      addStep('building-alice-ring', 'Fetching ring members for Alice\'s input...')
      const { globalTxoCount } = await getMerkleProofs([BigInt(aliceTxOut.globalIndex)])
      const gTxoCount = BigInt(globalTxoCount)

      const allSelectedIndices = new Set([aliceTxOut.globalIndex, bobTxOut.globalIndex])
      const aliceRingResult = await buildRingForInput(aliceTxOut, gTxoCount, allSelectedIndices)
      addStep('building-alice-ring', `Ring built: ${aliceRingResult.ring.length} members, real at index ${aliceRingResult.realIndex}`)

      // ── Phase 6: Build Alice's required output ──
      // Alice wants to receive (aliceTxOut.value - swapValue) back to herself
      addStep('building-alice-required-output', 'Building required output TxOut for Alice...')
      const aliceRequiredValue = aliceTxOut.value - swapBigInt
      const aliceDefaultSubaddr = await deriveSubaddress(aliceKey, 0n)
      const aliceRecipient: Recipient = {
        view_public_key: aliceDefaultSubaddr.view_public_key,
        spend_public_key: aliceDefaultSubaddr.spend_public_key,
        fog_report_url: aliceDefaultSubaddr.fog_report_url,
      }
      const aliceRequiredTxOut: BuiltTxOut = await buildTxOut(
        aliceRecipient,
        aliceRequiredValue,
        0n,
        fogIngestPubkey,
      )
      addStep(
        'building-alice-required-output',
        `Required output: ${picoToMob(aliceRequiredValue)} MOB to Alice`,
      )

      // ── Phase 7: Create Alice's SCI ──
      addStep('creating-sci', 'Creating Signed Contingent Input...')
      const aliceSCI: SignedContingentInput = await createSignedContingentInput(
        aliceKey,
        {
          real_index: aliceRingResult.realIndex,
          ring: aliceRingResult.ring,
          subaddress_index: aliceTxOut.subaddressIndex,
          value: aliceTxOut.value,
          token_id: 0n,
        },
        [aliceRequiredTxOut],
        tombstoneBlock,
        3, // block version
      )
      const sciKeyImage = bytesToHex(aliceSCI.mlsag.key_image)
      setState((prev) => ({
        ...prev,
        sciKeyImage,
        sciInputValue: aliceTxOut.value,
        sciRequiredOutputValue: aliceRequiredValue,
      }))
      addStep(
        'creating-sci',
        `SCI created! Input: ${picoToMob(aliceTxOut.value)} MOB, Required: ${picoToMob(aliceRequiredValue)} MOB, Key image: ${sciKeyImage.slice(0, 16)}...`,
      )

      // ── Phase 8: Build Bob's ring ──
      addStep('building-bob-ring', 'Fetching ring members for Bob\'s input...')
      const bobRingResult = await buildRingForInput(bobTxOut, gTxoCount, allSelectedIndices)
      addStep('building-bob-ring', `Ring built: ${bobRingResult.ring.length} members, real at index ${bobRingResult.realIndex}`)

      // ── Phase 9: Bob fills Alice's SCI ──
      addStep('filling-sci', 'Bob filling Alice\'s SCI (building + signing transaction)...')
      const bobChangeRecipient: Recipient = {
        view_public_key: bobSubaddr1.view_public_key,
        spend_public_key: bobSubaddr1.spend_public_key,
        fog_report_url: bobSubaddr1.fog_report_url,
      }

      const bobWasmInput: OwnedTxOutInput = {
        real_index: bobRingResult.realIndex,
        ring: bobRingResult.ring,
        subaddress_index: bobTxOut.subaddressIndex,
        value: bobTxOut.value,
        token_id: 0n,
      }

      const txResult: TxBuildResult = await fillSCITransaction(
        aliceSCI,
        bobKey,
        [bobWasmInput],
        bobChangeRecipient,
        fee,
        tombstoneBlock,
        fogIngestPubkey,
      )

      const txPrefixHash = bytesToHex(txResult.tx_prefix_hash)
      const keyImages = txResult.key_images.map((ki) => bytesToHex(ki))
      setState((prev) => ({ ...prev, txPrefixHash, keyImages }))
      addStep(
        'filling-sci',
        `Transaction built! ${txResult.tx_bytes.length} bytes, ${keyImages.length} inputs, prefix: ${txPrefixHash.slice(0, 16)}...`,
      )

      // ── Phase 10: Submit to consensus ──
      addStep('submitting', 'Submitting transaction to consensus network...')
      const txBytes = Uint8Array.from(txResult.tx_bytes)
      const submitResult = await submitTransaction(txBytes)

      setState((prev) => ({
        ...prev,
        submitResult: submitResult.result,
        blockCount: submitResult.blockCount,
      }))

      if (submitResult.result !== 'Ok') {
        throw new Error(
          `Transaction rejected: ${submitResult.errMsg ?? submitResult.result}`,
        )
      }
      addStep(
        'submitting',
        `Accepted! Result: ${submitResult.result}, block count: ${submitResult.blockCount}`,
      )

      // ── Phase 11: Wait for confirmation ──
      addStep('waiting', 'Waiting 60s for transaction to settle...')
      await new Promise((resolve) => setTimeout(resolve, 60_000))

      // ── Phase 12: Re-sync balances ──
      addStep('resyncing-alice', 'Re-syncing Alice\'s balance...')
      const aliceSyncAfter = await syncFogBalance(aliceKey)
      const aliceBalanceAfter: BalanceSnapshot = {
        total: aliceSyncAfter.totalBalance,
        spendableCount: aliceSyncAfter.ownedTxOuts.filter((t) => !t.spent && t.tokenId === 0n)
          .length,
        txOuts: aliceSyncAfter.ownedTxOuts,
      }
      setState((prev) => ({ ...prev, aliceBalanceAfter }))
      addStep('resyncing-alice', `Alice new balance: ${picoToMob(aliceSyncAfter.totalBalance)} MOB`)

      addStep('resyncing-bob', 'Re-syncing Bob\'s balance...')
      const bobSyncAfter = await syncFogBalance(bobKey)
      const bobBalanceAfter: BalanceSnapshot = {
        total: bobSyncAfter.totalBalance,
        spendableCount: bobSyncAfter.ownedTxOuts.filter((t) => !t.spent && t.tokenId === 0n)
          .length,
        txOuts: bobSyncAfter.ownedTxOuts,
      }
      setState((prev) => ({ ...prev, bobBalanceAfter }))
      addStep('resyncing-bob', `Bob new balance: ${picoToMob(bobSyncAfter.totalBalance)} MOB`)

      // ── Done ──
      addStep('done', 'E2E SCI swap test complete!')
      setState((prev) => ({ ...prev, phase: 'done' }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[SCI-E2E] Error:', err)
      setState((prev) => ({ ...prev, phase: 'error', error: message }))
    }
  }, [aliceMnemonic, bobMnemonic, swapValue, addStep])

  const isRunning = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error'

  const phaseProgress: Record<TestPhase, number> = {
    idle: 0,
    'deriving-keys': 5,
    'syncing-alice': 15,
    'syncing-bob': 25,
    'fetching-network': 30,
    'building-alice-ring': 40,
    'building-alice-required-output': 45,
    'creating-sci': 55,
    'building-bob-ring': 60,
    'filling-sci': 70,
    submitting: 80,
    waiting: 85,
    'resyncing-alice': 90,
    'resyncing-bob': 95,
    done: 100,
    error: 0,
  }

  return (
    <Stack p="xl" gap="md">
      <Text size="xl" fw={700}>
        SCI Atomic Swap — E2E Test
      </Text>

      <Alert color="yellow" title="Real Network Transaction">
        This test creates a REAL Signed Contingent Input and submits it to the MobileCoin network.
        Both accounts must have funded wallets. Alice offers a portion of her UTXO via SCI, Bob fills
        it with his own input. The transaction is submitted to consensus and balances are verified.
      </Alert>

      {/* ── Input Form ── */}
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={600}>Test Configuration</Text>
          <Textarea
            label="Alice's Mnemonic (Maker — creates SCI)"
            placeholder="Enter Alice's 24-word mnemonic..."
            minRows={2}
            value={aliceMnemonic}
            onChange={(e) => setAliceMnemonic(e.currentTarget.value)}
            disabled={isRunning}
          />
          <Textarea
            label="Bob's Mnemonic (Taker — fills SCI)"
            placeholder="Enter Bob's 24-word mnemonic..."
            minRows={2}
            value={bobMnemonic}
            onChange={(e) => setBobMnemonic(e.currentTarget.value)}
            disabled={isRunning}
          />
          <NumberInput
            label="Swap Value (picoMOB)"
            description={`Alice gives this amount to Bob. ${picoToMob(BigInt(swapValue))} MOB`}
            value={swapValue}
            onChange={(v) => setSwapValue(typeof v === 'number' ? v : 500_000_000_000)}
            min={1_000_000_000}
            step={100_000_000_000}
            disabled={isRunning}
          />
          <Group>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={runTest}
              loading={isRunning}
              disabled={isRunning || !aliceMnemonic.trim() || !bobMnemonic.trim()}
            >
              Run E2E SCI Swap Test
            </Button>
            {(state.phase === 'done' || state.phase === 'error') && (
              <Button
                leftSection={<IconRefresh size={16} />}
                variant="subtle"
                onClick={() => setState({ phase: 'idle', steps: [] })}
              >
                Reset
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* ── Progress ── */}
      {state.phase !== 'idle' && (
        <Paper p="md" withBorder>
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>Progress</Text>
              {isRunning && <Loader size="sm" />}
            </Group>
            <Progress
              value={phaseProgress[state.phase]}
              color={state.phase === 'error' ? 'red' : state.phase === 'done' ? 'green' : 'blue'}
              animated={isRunning}
            />
            <Stack gap={4}>
              {state.steps.map((step, i) => (
                <Text key={i} size="xs" c={step.phase === 'error' ? 'red' : 'dimmed'} component="span" style={{ display: 'block' }}>
                  <Badge
                    size="xs"
                    mr={4}
                    color={
                      step.phase === 'error'
                        ? 'red'
                        : step.phase === 'done'
                          ? 'green'
                          : step.phase === state.phase
                            ? 'blue'
                            : 'gray'
                    }
                  >
                    {step.phase}
                  </Badge>
                  {step.detail}
                </Text>
              ))}
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* ── Error ── */}
      {state.phase === 'error' && state.error && (
        <Alert icon={<IconAlertCircle size={16} />} title="Test Failed" color="red">
          {state.error}
        </Alert>
      )}

      {/* ── Addresses ── */}
      {(state.aliceAddress || state.bobAddress) && (
        <Paper p="md" withBorder>
          <Stack gap="xs">
            <Text fw={600}>Addresses</Text>
            {state.aliceAddress && (
              <Text size="xs" c="dimmed">
                Alice: {state.aliceAddress}
              </Text>
            )}
            {state.bobAddress && (
              <Text size="xs" c="dimmed">
                Bob: {state.bobAddress}
              </Text>
            )}
          </Stack>
        </Paper>
      )}

      {/* ── SCI Info ── */}
      {state.sciKeyImage && (
        <Paper p="md" withBorder>
          <Stack gap="xs">
            <Text fw={600}>Signed Contingent Input</Text>
            <Group gap="xs">
              <Badge color="blue">
                Input: {state.sciInputValue ? picoToMob(state.sciInputValue) : '?'} MOB
              </Badge>
              <Badge color="green">
                Required: {state.sciRequiredOutputValue ? picoToMob(state.sciRequiredOutputValue) : '?'} MOB
              </Badge>
              <Badge color="orange">
                Swap: {picoToMob(BigInt(swapValue))} MOB
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Key Image: {state.sciKeyImage}
            </Text>
          </Stack>
        </Paper>
      )}

      {/* ── Transaction ── */}
      {state.txPrefixHash && (
        <Paper p="md" withBorder>
          <Stack gap="xs">
            <Text fw={600}>Transaction</Text>
            <Text size="xs" c="dimmed">
              Prefix Hash: {state.txPrefixHash}
            </Text>
            {state.keyImages?.map((ki, i) => (
              <Text key={i} size="xs" c="dimmed">
                Key Image {i}: {ki}
              </Text>
            ))}
            {state.submitResult && (
              <Badge
                size="lg"
                color={state.submitResult === 'Ok' ? 'green' : 'red'}
                leftSection={state.submitResult === 'Ok' ? <IconCheck size={14} /> : undefined}
              >
                Consensus: {state.submitResult}
              </Badge>
            )}
            {state.blockCount && (
              <Text size="xs" c="dimmed">
                Block count at submission: {state.blockCount}
              </Text>
            )}
          </Stack>
        </Paper>
      )}

      {/* ── Balance Comparison ── */}
      {state.aliceBalanceBefore && (
        <Paper p="md" withBorder bg="dark.8">
          <Stack gap="md">
            <Text fw={600}>Balance Summary</Text>

            <Divider label="Alice (Maker)" labelPosition="left" />
            <Group gap="lg">
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Before</Text>
                <Text fw={600}>{picoToMob(state.aliceBalanceBefore.total)} MOB</Text>
                <Text size="xs" c="dimmed">
                  {state.aliceBalanceBefore.spendableCount} UTXOs
                </Text>
              </Stack>
              {state.aliceBalanceAfter && (
                <>
                  <Text c="dimmed">→</Text>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">After</Text>
                    <Text fw={600}>{picoToMob(state.aliceBalanceAfter.total)} MOB</Text>
                    <Text size="xs" c="dimmed">
                      {state.aliceBalanceAfter.spendableCount} UTXOs
                    </Text>
                  </Stack>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Change</Text>
                    <Text
                      fw={600}
                      c={state.aliceBalanceAfter.total < state.aliceBalanceBefore.total ? 'red' : 'green'}
                    >
                      {state.aliceBalanceAfter.total >= state.aliceBalanceBefore.total ? '+' : ''}
                      {picoToMob(state.aliceBalanceAfter.total - state.aliceBalanceBefore.total)} MOB
                    </Text>
                  </Stack>
                </>
              )}
            </Group>

            {state.bobBalanceBefore && (
              <>
                <Divider label="Bob (Taker)" labelPosition="left" />
                <Group gap="lg">
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Before</Text>
                    <Text fw={600}>{picoToMob(state.bobBalanceBefore.total)} MOB</Text>
                    <Text size="xs" c="dimmed">
                      {state.bobBalanceBefore.spendableCount} UTXOs
                    </Text>
                  </Stack>
                  {state.bobBalanceAfter && (
                    <>
                      <Text c="dimmed">→</Text>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">After</Text>
                        <Text fw={600}>{picoToMob(state.bobBalanceAfter.total)} MOB</Text>
                        <Text size="xs" c="dimmed">
                          {state.bobBalanceAfter.spendableCount} UTXOs
                        </Text>
                      </Stack>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">Change</Text>
                        <Text
                          fw={600}
                          c={state.bobBalanceAfter.total < state.bobBalanceBefore.total ? 'red' : 'green'}
                        >
                          {state.bobBalanceAfter.total >= state.bobBalanceBefore.total ? '+' : ''}
                          {picoToMob(state.bobBalanceAfter.total - state.bobBalanceBefore.total)} MOB
                        </Text>
                      </Stack>
                    </>
                  )}
                </Group>
              </>
            )}

            {state.phase === 'done' && state.aliceBalanceAfter && state.bobBalanceAfter && (
              <>
                <Divider />
                <Group gap="lg">
                  <Badge size="lg" color="green" leftSection={<IconCheck size={14} />}>
                    E2E SCI Swap Complete
                  </Badge>
                  <Text size="sm" c="dimmed">
                    Fee paid: {picoToMob(MINIMUM_FEE)} MOB
                  </Text>
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  )
}

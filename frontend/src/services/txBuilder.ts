/**
 * Transaction builder orchestrator.
 *
 * Coordinates the full send flow:
 *   1. Decode recipient B58 address (WASM)
 *   2. Select inputs (greedy coin selection)
 *   3. Get network status (block height)
 *   4. Get fog ingest pubkey (for fog hints)
 *   5. For each input: fetch merkle proof + ring samples, build ring
 *   6. Build + sign transaction (WASM — all crypto here)
 *   7. Submit signed TX to consensus
 *
 * JS handles ONLY network I/O. Private keys never leave WASM.
 */

import {
  decodeB58Address,
  buildTransaction,
  deriveSubaddress,
  type WalletAccountKey,
  type OwnedTxOutInput,
  type RingMember,
  type TxBuildResult,
  type Recipient,
} from '@ddex/wallet-core-web'
import type { OwnedTxOut } from './fogClient'
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
  type TxSubmitResult,
} from './consensusClient'

// ── Types ──

export type TxBuildPhase =
  | 'validating'
  | 'selecting-inputs'
  | 'fetching-network'
  | 'fetching-fog-report'
  | 'building-rings'
  | 'signing'
  | 'submitting'
  | 'done'
  | 'error'

export interface TxBuildProgress {
  phase: TxBuildPhase
  detail?: string
}

export interface SendResult {
  success: boolean
  txPrefixHash?: Uint8Array
  keyImages?: Uint8Array[]
  confirmationNumber?: Uint8Array
  tombstoneBlock?: bigint
  blockCount?: string
  error?: string
}

// ── Coin selection ──

/**
 * Greedy coin selection: pick fewest UTXOs that cover amount + fee.
 * Sorts by value descending so we use fewer inputs (smaller TX).
 * MobileCoin limits to 16 inputs per TX.
 */
function selectInputs(
  ownedTxOuts: OwnedTxOut[],
  amount: bigint,
  fee: bigint,
): OwnedTxOut[] {
  const target = amount + fee
  const spendable = ownedTxOuts
    .filter((txo) => !txo.spent && txo.tokenId === 0n)
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))

  const selected: OwnedTxOut[] = []
  let total = 0n

  for (const txo of spendable) {
    selected.push(txo)
    total += txo.value
    if (total >= target) break
  }

  if (total < target) {
    throw new Error(
      `Insufficient balance: need ${target} picoMOB but only ${total} available`,
    )
  }

  if (selected.length > 16) {
    throw new Error('Too many inputs needed (max 16). Try a smaller amount.')
  }

  return selected
}

// ── Ring construction ──

/**
 * Build a ring of RING_SIZE members for one real input.
 * Returns the ring array and the real_index within it.
 */
async function buildRingForInput(
  realTxOut: OwnedTxOut,
  globalTxoCount: bigint,
  allSelectedIndices: Set<string>,
): Promise<{ ring: RingMember[]; realIndex: number }> {
  // Fetch merkle proof for our real input
  const { proofs } = await getMerkleProofs([BigInt(realTxOut.globalIndex)])
  const realProof = proofs[0]
  if (!realProof) throw new Error(`No merkle proof for index ${realTxOut.globalIndex}`)

  // Fetch RING_SIZE - 1 random decoys
  const decoyCount = RING_SIZE - 1
  const excludeSet = new Set(allSelectedIndices)
  excludeSet.add(realTxOut.globalIndex)
  const decoys = await getRingSamples(decoyCount, globalTxoCount, excludeSet)

  if (decoys.length < decoyCount) {
    throw new Error(
      `Not enough decoys: got ${decoys.length}, need ${decoyCount}. ` +
      `Global TXO count: ${globalTxoCount}`,
    )
  }

  // Combine real + decoys, sort by global index (consensus requirement)
  const allMembers: { proof: MerkleProofResult; isReal: boolean }[] = [
    { proof: realProof, isReal: true },
    ...decoys.map((d) => ({ proof: d, isReal: false })),
  ]
  allMembers.sort((a, b) => {
    const ai = BigInt(a.proof.index)
    const bi = BigInt(b.proof.index)
    return ai < bi ? -1 : ai > bi ? 1 : 0
  })

  const realIndex = allMembers.findIndex((m) => m.isReal)

  const ring: RingMember[] = allMembers.map((m) => ({
    target_key: m.proof.txOut.target_key,
    public_key: m.proof.txOut.public_key,
    commitment: m.proof.txOut.commitment,
    tx_out_bytes: Array.from(m.proof.txOutBytes),
    proof_bytes: Array.from(m.proof.proofBytes),
  }))

  return { ring, realIndex }
}

// ── Main send flow ──

/**
 * Build and submit a MobileCoin transaction.
 *
 * @param accountKey  - Wallet account key (private keys stay in WASM)
 * @param ownedTxOuts - Unspent outputs from fog sync
 * @param recipientB58 - Recipient's B58-encoded public address
 * @param amount      - Amount in picoMOB to send
 * @param onProgress  - Optional callback for UI updates
 */
export async function sendTransaction(
  accountKey: WalletAccountKey,
  ownedTxOuts: OwnedTxOut[],
  recipientB58: string,
  amount: bigint,
  onProgress?: (progress: TxBuildProgress) => void,
): Promise<SendResult> {
  const report = (phase: TxBuildPhase, detail?: string) =>
    onProgress?.({ phase, detail })

  try {
    const toHex = (arr: number[] | Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')

    // 1. Decode + validate recipient address
    report('validating', 'Decoding recipient address...')
    console.log(`[txSend] === SEND START === amount=${amount} picoMOB (${Number(amount) / 1e12} MOB), recipient=${recipientB58}`)
    const decoded = await decodeB58Address(recipientB58)
    console.log(`[txSend] Decoded recipient: view_pub=${toHex(decoded.view_public_key)}, spend_pub=${toHex(decoded.spend_public_key)}, fog=${decoded.fog_report_url}`)
    const recipient: Recipient = {
      view_public_key: decoded.view_public_key,
      spend_public_key: decoded.spend_public_key,
      fog_report_url: decoded.fog_report_url,
    }

    // 2. Select inputs (coin selection)
    report('selecting-inputs', 'Choosing outputs to spend...')
    const fee = MINIMUM_FEE
    console.log(`[txSend] Coin selection: amount=${amount}, fee=${fee}, total needed=${amount + fee}`)
    console.log(`[txSend] Available UTXOs: ${ownedTxOuts.filter(t => !t.spent && t.tokenId === 0n).length} unspent MOB outputs`)
    for (const txo of ownedTxOuts.filter(t => !t.spent && t.tokenId === 0n)) {
      console.log(`[txSend]   UTXO: globalIdx=${txo.globalIndex}, value=${txo.value} picoMOB (${Number(txo.value) / 1e12} MOB), subaddr=${txo.subaddressIndex}`)
    }
    const selectedInputs = selectInputs(ownedTxOuts, amount, fee)
    const selectedIndices = new Set(selectedInputs.map((i) => i.globalIndex))
    console.log(`[txSend] Selected ${selectedInputs.length} input(s), total=${selectedInputs.reduce((s, i) => s + i.value, 0n)} picoMOB`)
    for (const inp of selectedInputs) {
      console.log(`[txSend]   Selected: globalIdx=${inp.globalIndex}, value=${inp.value}, keyImage=${toHex(inp.keyImage)}`)
    }
    const changeAmount = selectedInputs.reduce((s, i) => s + i.value, 0n) - amount - fee
    console.log(`[txSend] Change amount: ${changeAmount} picoMOB (${Number(changeAmount) / 1e12} MOB)`)

    // 3. Get network status (block height for tombstone)
    report('fetching-network', 'Getting current block height...')
    const networkStatus = await getNetworkStatus()
    const tombstoneBlock = networkStatus.blockHeight + TOMBSTONE_OFFSET
    console.log(`[txSend] Network: blockHeight=${networkStatus.blockHeight}, tombstone=${tombstoneBlock}`)

    // 4. Get fog ingest pubkey (for fog hints on recipient's outputs)
    report('fetching-fog-report', 'Fetching fog report...')
    const fogIngestPubkey = await getFogIngestPubkey()
    console.log(`[txSend] Fog ingest pubkey: ${toHex(fogIngestPubkey)} (${fogIngestPubkey.length} bytes)`)

    // 5. Build rings for each input (parallel per input)
    report('building-rings', `Building rings for ${selectedInputs.length} input(s)...`)
    const globalTxoCount = await getGlobalTxoCount(selectedInputs)

    const ringResults = await Promise.all(
      selectedInputs.map((input) =>
        buildRingForInput(input, globalTxoCount, selectedIndices),
      ),
    )

    // 6. Assemble WASM inputs
    const wasmInputs: OwnedTxOutInput[] = selectedInputs.map((input, i) => ({
      real_index: ringResults[i].realIndex,
      ring: ringResults[i].ring,
      subaddress_index: input.subaddressIndex,
      value: input.value,
      token_id: input.tokenId,
    }))

    // 7. Derive change subaddress (subaddress 1 by convention)
    const changeSubaddress = await deriveSubaddress(accountKey, 1n)
    console.log(`[txSend] Change subaddress 1: view_pub=${toHex(changeSubaddress.view_public_key)}, spend_pub=${toHex(changeSubaddress.spend_public_key)}, fog=${changeSubaddress.fog_report_url}`)
    const changeRecipient: Recipient = {
      view_public_key: changeSubaddress.view_public_key,
      spend_public_key: changeSubaddress.spend_public_key,
      fog_report_url: changeSubaddress.fog_report_url,
    }

    // 8. Build + sign the transaction (ALL crypto in WASM)
    report('signing', 'Signing transaction...')
    const txResult: TxBuildResult = await buildTransaction(
      accountKey,
      wasmInputs,
      recipient,
      amount,
      fee,
      changeRecipient,
      tombstoneBlock,
      fogIngestPubkey,
      1n, // paymentRequestId — non-zero triggers AuthenticatedSenderMemo (0x0101)
    )

    // 9. Submit to consensus
    report('submitting', 'Submitting to network...')
    const txBytes = Uint8Array.from(txResult.tx_bytes)
    console.log('[txBuilder] tx_bytes from WASM:', txBytes.length, 'bytes, first 16:', Array.from(txBytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '))
    console.log('[txBuilder] key_images:', txResult.key_images.length, ', confirmation:', txResult.confirmation_number.length, 'bytes')
    const submitResult: TxSubmitResult = await submitTransaction(txBytes)
    console.log(`[txSend] Submit result: ${submitResult.result}, blockCount=${submitResult.blockCount}${submitResult.errMsg ? ', err=' + submitResult.errMsg : ''}`)

    if (submitResult.result !== 'Ok') {
      throw new Error(`Transaction rejected: ${submitResult.errMsg ?? submitResult.result}`)
    }

    report('done', `Accepted at block ~${submitResult.blockCount}`)
    console.log(`[txSend] === SEND SUCCESS === accepted at block ~${submitResult.blockCount}`)

    return {
      success: true,
      txPrefixHash: Uint8Array.from(txResult.tx_prefix_hash),
      keyImages: txResult.key_images.map((ki) => Uint8Array.from(ki)),
      confirmationNumber: Uint8Array.from(txResult.confirmation_number),
      tombstoneBlock,
      blockCount: submitResult.blockCount,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    report('error', message)
    return { success: false, error: message }
  }
}

// ── Helpers ──

/**
 * Get globalTxoCount from the merkle proof of the first selected input.
 * Used to know the range for random decoy sampling.
 */
async function getGlobalTxoCount(selectedInputs: OwnedTxOut[]): Promise<bigint> {
  const { globalTxoCount } = await getMerkleProofs([
    BigInt(selectedInputs[0].globalIndex),
  ])
  return BigInt(globalTxoCount)
}

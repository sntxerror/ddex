/**
 * Consensus and fog-ledger network client for transaction building and submission.
 *
 * Handles:
 *   - GetLastBlockInfo (block height + minimum fee)
 *   - GetOutputs / merkle proofs (for ring construction)
 *   - Ring sampling (random decoys)
 *   - ClientTxPropose (submit signed transaction)
 *   - GetReports (fog ingest pubkey for fog hints)
 *
 * All crypto stays in WASM — this module only does network I/O.
 */

import { getConnection, dropConnection } from '../lib/attested'
import { grpcFetch } from '../lib/grpc'
import {
  encodeGetOutputsRequest,
  decodeGetOutputsResponse,
  decodeLastBlockInfo,
  decodeProposeTxResponse,
  decodeReportResponse,
  type OutputResult,
  hexToBytes,
  base64ToBytes,
} from '../lib/mc-proto'

// ── Configuration ──

/** Envoy prefix for mainnet fog (fog-view + fog-ledger) */
const FOG_PREFIX = '/prod/fog'
/** Envoy prefix for mainnet consensus */
const CONSENSUS_PREFIX = '/prod/consensus'

const FOG_LEDGER_RESPONDER = 'fog.prod.mobilecoinww.com:443'
const CONSENSUS_RESPONDER = 'node1.prod.mobilecoinww.com:443'

const PATHS = {
  fogMerkleAuth: '/fog_ledger.FogMerkleProofAPI/Auth',
  fogMerkleGetOutputs: '/fog_ledger.FogMerkleProofAPI/GetOutputs',
  reportGetReports: '/report.ReportAPI/GetReports',
  blockchainGetLastBlockInfo: '/consensus_common.BlockchainAPI/GetLastBlockInfo',
  consensusAuth: '/attest.AttestedApi/Auth',
  consensusPropose: '/consensus_client.ConsensusClientAPI/ClientTxPropose',
} as const

/** MobileCoin ring size (exactly 11, enforced by consensus) */
export const RING_SIZE = 11

/** Minimum fee in picoMOB (0.0004 MOB) */
export const MINIMUM_FEE = 400_000_000n

/** Tombstone offset: current block + 50 (~50 minutes) */
export const TOMBSTONE_OFFSET = 50n

// ── Error code mapping for ProposeTxResult ──

const PROPOSE_TX_RESULTS: Record<number, string> = {
  0: 'Ok',
  10: 'InputsProofsLengthMismatch',
  11: 'NoInputs',
  12: 'TooManyInputs',
  13: 'InsufficientInputSignatures',
  14: 'InvalidInputSignature',
  16: 'InvalidRangeProof',
  17: 'InsufficientRingSize',
  18: 'TombstoneBlockExceeded',
  19: 'TombstoneBlockTooFar',
  20: 'NoOutputs',
  21: 'TooManyOutputs',
  23: 'DuplicateRingElements',
  24: 'UnsortedRingElements',
  27: 'ContainsSpentKeyImage',
  28: 'DuplicateKeyImages',
  29: 'DuplicateOutputPublicKey',
  30: 'ContainsExistingOutputPublicKey',
  32: 'InvalidTxOutMembershipProof',
  37: 'TxFeeError',
  40: 'MissingMemo',
  45: 'UnsortedOutputs',
}

// ── Connection getters ──

function fogMerkleConn() {
  return getConnection(
    'fog-merkle',
    FOG_LEDGER_RESPONDER,
    `${FOG_PREFIX}${PATHS.fogMerkleAuth}`,
  )
}

function consensusConn() {
  return getConnection(
    'consensus',
    CONSENSUS_RESPONDER,
    `${CONSENSUS_PREFIX}${PATHS.consensusAuth}`,
  )
}

// ── Public API ──

export interface NetworkStatus {
  blockHeight: bigint
  networkBlockVersion: string
}

/**
 * Get current block height and network info.
 * This is a plain (non-attested) gRPC call to BlockchainAPI.
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  const { data } = await grpcFetch(
    `${CONSENSUS_PREFIX}${PATHS.blockchainGetLastBlockInfo}`,
    new Uint8Array(0), // Empty request
    { timeoutMs: 15_000 },
  )
  const info = decodeLastBlockInfo(data)
  return {
    blockHeight: BigInt(info.index),
    networkBlockVersion: info.networkBlockVersion,
  }
}

export interface MerkleProofResult {
  index: string
  txOut: { target_key: number[]; public_key: number[]; commitment: number[] }
  txOutBytes: Uint8Array
  proofBytes: Uint8Array
}

/**
 * Fetch merkle proofs for TxOuts by global index.
 * Attested call to FogMerkleProofAPI.
 */
export async function getMerkleProofs(
  globalIndices: bigint[],
): Promise<{ proofs: MerkleProofResult[]; globalTxoCount: string }> {
  const requestBytes = encodeGetOutputsRequest(globalIndices, 0n)
  const conn = fogMerkleConn()
  const responseBytes = await conn.encryptedCall(
    `${FOG_PREFIX}${PATHS.fogMerkleGetOutputs}`,
    requestBytes,
  )
  const resp = decodeGetOutputsResponse(responseBytes)

  return {
    proofs: resp.results.map((r: OutputResult) => ({
      index: r.index,
      txOut: r.txOut,
      txOutBytes: base64ToBytes(r.txOutBytes),
      proofBytes: base64ToBytes(r.proofBytes),
    })),
    globalTxoCount: resp.globalTxoCount,
  }
}

/**
 * Fetch random ring samples (decoy TxOuts) for ring construction.
 * Uses crypto.getRandomValues for uniform random index generation.
 */
export async function getRingSamples(
  count: number,
  globalTxoCount: bigint,
  excludeIndices: Set<string>,
): Promise<MerkleProofResult[]> {
  // Over-sample 2x to account for filtering (non-existent outputs)
  const targetCount = count * 2
  const indices: bigint[] = []
  let attempts = 0
  const total = Number(globalTxoCount)
  const seen = new Set<number>()

  while (indices.length < targetCount && attempts < targetCount * 20) {
    const rngBuf = new Uint32Array(1)
    crypto.getRandomValues(rngBuf)
    const idx = rngBuf[0] % total
    if (!excludeIndices.has(String(idx)) && !seen.has(idx)) {
      seen.add(idx)
      indices.push(BigInt(idx))
    }
    attempts++
  }

  const requestBytes = encodeGetOutputsRequest(indices, 0n)
  const conn = fogMerkleConn()
  const responseBytes = await conn.encryptedCall(
    `${FOG_PREFIX}${PATHS.fogMerkleGetOutputs}`,
    requestBytes,
  )
  const resp = decodeGetOutputsResponse(responseBytes)

  // Filter to Exists results (code 2), take what we need
  return resp.results
    .filter((r: OutputResult) => r.resultCode === 2)
    .slice(0, count)
    .map((r: OutputResult) => ({
      index: r.index,
      txOut: r.txOut,
      txOutBytes: base64ToBytes(r.txOutBytes),
      proofBytes: base64ToBytes(r.proofBytes),
    }))
}

export interface TxSubmitResult {
  result: string
  blockCount: string
  errMsg?: string
}

/**
 * Submit a signed transaction to consensus.
 * Uses attested (Noise NX) connection to consensus enclave.
 * Re-attestation on session expiry is handled by AttestedConnection.encryptedCall().
 */
export async function submitTransaction(txBytes: Uint8Array): Promise<TxSubmitResult> {
  console.log('[consensus] submitTransaction: plaintext', txBytes.length, 'bytes')
  const conn = consensusConn()

  try {
    const responseBytes = await conn.encryptedCallPlaintextResponse(
      `${CONSENSUS_PREFIX}${PATHS.consensusPropose}`,
      txBytes,
      new Uint8Array(0),
      { timeoutMs: 30_000 },
    )

    const resp = decodeProposeTxResponse(responseBytes)
    const resultName = PROPOSE_TX_RESULTS[resp.result] ?? `Unknown_${resp.result}`

    return {
      result: resultName,
      blockCount: resp.blockCount,
      errMsg: resp.result !== 0 ? (resp.errMsg || resultName) : undefined,
    }
  } catch (err) {
    dropConnection('consensus')
    throw err
  }
}

// ── Fog Report (ingest pubkey) ──

const FOG_REPORT_TTL_MS = 5 * 60 * 1000
let cachedIngressPubkey: { key: Uint8Array; fetchedAt: number } | null = null

/**
 * Fetch the fog ingest INGRESS pubkey from the fog report.
 *
 * CRITICAL: This is NOT the KexRng egress key from RNG records.
 * The ingress key encrypts fog hints so fog-ingest can index TxOuts.
 * Using the wrong key = TX on chain but fog can't find the outputs.
 *
 * Cached for 5 minutes (fog-ingest rotations are rare).
 */
export async function getFogIngestPubkey(): Promise<Uint8Array> {
  if (cachedIngressPubkey && Date.now() - cachedIngressPubkey.fetchedAt < FOG_REPORT_TTL_MS) {
    return cachedIngressPubkey.key
  }

  // Plain gRPC call (no attestation needed for reports)
  const { data } = await grpcFetch(
    `${FOG_PREFIX}${PATHS.reportGetReports}`,
    new Uint8Array(0),
    { timeoutMs: 15_000 },
  )

  const reportResp = decodeReportResponse(data)
  const firstReport = reportResp.reports[0]

  if (!firstReport?.ingressPubkey || firstReport.ingressPubkey.length !== 64) {
    // Use stale cache if available
    if (cachedIngressPubkey) {
      console.warn('[consensus] fog report missing ingress pubkey — using stale cache')
      return cachedIngressPubkey.key
    }
    throw new Error('Fog report missing ingress pubkey — cannot create fog hints')
  }

  const key = hexToBytes(firstReport.ingressPubkey)
  cachedIngressPubkey = { key, fetchedAt: Date.now() }
  return key
}

/**
 * Reset all consensus and merkle connections (e.g. on wallet lock).
 */
export function resetConsensusConnections(): void {
  dropConnection('fog-merkle')
  dropConnection('consensus')
  cachedIngressPubkey = null
}

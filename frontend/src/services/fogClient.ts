/**
 * Fog balance sync client for MobileCoin.
 *
 * Implements the same two-phase polling algorithm as MC's reference client
 * (see mobilecoin/fog/view/protocol/src/polling.rs):
 *
 *   Phase 1 — Empty query: get RNG records + sync metadata
 *   Phase 2 — Exponential search loop:
 *     - Start with 1 key/RNG, double each round, cap at 500/num_live_rngs
 *     - Each RNG is a stateful cursor with start_index tracking
 *     - "Dead" RNGs (didn't advance full request_multiplier) stop being queried
 *     - Loop until all RNGs are dead
 *     - Active RNGs queried first for fast initial balance
 *   Phase 3 — Key image check for spent detection
 *   Phase 4 — Sum unspent balance
 *
 * Intermediate results are emitted via onResult callback so the UI can
 * show a quick initial balance while deeper scanning continues.
 */

import { getConnection, dropConnection } from '../lib/attested'
import { GrpcError, GRPC_STATUS } from '../lib/grpc'
import {
  encodeQueryRequest,
  encodeQueryRequestAAD,
  decodeQueryResponse,
  decodeTxOutRecord,
  encodeCheckKeyImagesRequest,
  decodeCheckKeyImagesResponse,
  encodeBlockRequest,
  decodeBlockResponse,
  type QueryResponse,
  type RngRecord,
  type FixedTxOutSearchResult,
  type BlockData,
} from '../lib/mc-proto'
import { grpcFetch } from '../lib/grpc'
import {
  deriveKexRngSearchKeys,
  decryptFogCiphertext,
  scanTxOut,
  type WalletAccountKey,
  type TxOutData,
  type DecodedMemo,
} from '@ddex/wallet-core-web'

// ── Mainnet Fog Configuration ──

const FOG_VIEW_RESPONDER = 'fog.prod.mobilecoinww.com:443'
const FOG_LEDGER_RESPONDER = 'fog.prod.mobilecoinww.com:443'
const PATH_PREFIX = '/prod/fog'

const PATHS = {
  fogViewAuth: '/fog_view.FogViewAPI/Auth',
  fogViewQuery: '/fog_view.FogViewAPI/Query',
  fogKeyImageAuth: '/fog_ledger.FogKeyImageAPI/Auth',
  fogKeyImageCheck: '/fog_ledger.FogKeyImageAPI/CheckKeyImages',
  fogBlockGetBlocks: '/fog_ledger.FogBlockAPI/GetBlocks',
} as const

// Max subaddresses to scan for ownership (0 = default, 1 = change)
const NUM_SUBADDRESSES = 2n

// Timeout for query calls
const QUERY_TIMEOUT_MS = 90_000

// MC reference caps at 500 search keys per gRPC query.
// Larger batches don't help due to ORAM overhead in the fog enclave.
const MAX_SEARCH_KEYS_PER_QUERY = 500

// ── Types ──

export interface OwnedTxOut {
  globalIndex: string
  blockIndex: string
  /** Block timestamp (seconds since epoch, 0 if unavailable) */
  timestamp: number
  value: bigint          // picoMOB
  tokenId: bigint
  keyImage: Uint8Array   // 32 bytes
  subaddressIndex: number
  spent: boolean
  /** Block in which this TxOut's key image was spent (0 if unspent) */
  spentAtBlock: string
  memo: DecodedMemo | null
}

export interface FogSyncResult {
  ownedTxOuts: OwnedTxOut[]
  totalBalance: bigint   // picoMOB (unspent only)
  highestProcessedBlock: string
  syncedAt: number       // Date.now()
}

export interface FogSyncProgress {
  phase: 'attesting' | 'querying-rng' | 'deriving-keys' | 'querying-txos' | 'scanning' | 'checking-key-images' | 'done' | 'error'
  detail?: string
}

// ── Internal: per-RNG cursor state ──

interface RngCursor {
  record: RngRecord
  /** Next search key counter (starts at 0, advances past found results) */
  nextIndex: bigint
  /** True when this RNG has been exhausted */
  dead: boolean
}

// ── Helpers ──

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function toHex(arr: Uint8Array | number[]): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Fog connections ──

function fogViewConn() {
  return getConnection(
    'fog-view',
    FOG_VIEW_RESPONDER,
    `${PATH_PREFIX}${PATHS.fogViewAuth}`,
  )
}

function fogKeyImageConn() {
  return getConnection(
    'fog-key-image',
    FOG_LEDGER_RESPONDER,
    `${PATH_PREFIX}${PATHS.fogKeyImageAuth}`,
  )
}

// ── Core: query fog-view with retry ──

async function fogViewQuery(
  searchKeys: Uint8Array[],
  startFromUserEventId: number,
  startFromBlockIndex: number,
  signal?: AbortSignal,
): Promise<QueryResponse> {
  const queryOpts = { timeoutMs: QUERY_TIMEOUT_MS, signal }
  const request = encodeQueryRequest(searchKeys)
  const aad = encodeQueryRequestAAD(startFromUserEventId, startFromBlockIndex)

  try {
    const conn = fogViewConn()
    const bytes = await conn.encryptedCall(
      `${PATH_PREFIX}${PATHS.fogViewQuery}`,
      request, aad, queryOpts,
    )
    return decodeQueryResponse(bytes)
  } catch (err) {
    if (isAbortError(err)) throw err
    if (err instanceof GrpcError &&
      (err.code === GRPC_STATUS.DEADLINE_EXCEEDED || err.code === GRPC_STATUS.UNAVAILABLE)) {
      console.warn('[fog] Query failed, retrying with fresh connection:', err)
      dropConnection('fog-view')
      const conn = fogViewConn()
      const bytes = await conn.encryptedCall(
        `${PATH_PREFIX}${PATHS.fogViewQuery}`,
        request, aad, queryOpts,
      )
      return decodeQueryResponse(bytes)
    }
    throw err
  }
}

// ── Core: process Found results → OwnedTxOut[] ──

async function processFoundResults(
  results: FixedTxOutSearchResult[],
  viewKey: Uint8Array,
  spendKey: Uint8Array,
): Promise<OwnedTxOut[]> {
  const owned: OwnedTxOut[] = []

  for (let fi = 0; fi < results.length; fi++) {
    const result = results[fi]
    try {
      const actualCiphertext = result.payloadLength > 0 && result.payloadLength < result.ciphertext.length
        ? result.ciphertext.slice(0, result.payloadLength)
        : result.ciphertext

      const plaintext = await decryptFogCiphertext(viewKey, spendKey, actualCiphertext)
      const record = decodeTxOutRecord(plaintext)

      console.log(`[fog]   TxOut: globalIndex=${record.globalIndex}, block=${record.blockIndex}, target=${toHex(record.txOutTargetKeyData).slice(0, 16)}..`)

      const txOutData: TxOutData = {
        target_key: Array.from(record.txOutTargetKeyData),
        public_key: Array.from(record.txOutPublicKeyData),
        masked_value: record.txOutAmountMaskedValue,
        masked_token_id: Array.from(record.txOutAmountMaskedTokenId),
        commitment: Array.from(record.txOutAmountCommitmentData),
        global_index: record.globalIndex,
        block_index: record.blockIndex,
        e_memo: record.txOutEMemoData.length > 0 ? Array.from(record.txOutEMemoData) : undefined,
      }

      const scanResult = await scanTxOut(txOutData, viewKey, spendKey, NUM_SUBADDRESSES)

      if (scanResult.owned && scanResult.value != null && scanResult.key_image != null) {
        // Parse block timestamp from TxOutRecord (seconds since epoch, u64::MAX → 0)
        const ts = Number(record.timestampBlockIndex)
        const timestamp = (ts > 0 && ts < 4294967295) ? ts : 0
        console.log(`[fog]     ✓ OWNED subaddr=${scanResult.subaddress_index}, value=${Number(scanResult.value) / 1e12} MOB, memo_type=${scanResult.memo?.memo_type ?? 'none'}, ts=${timestamp}`)
        owned.push({
          globalIndex: scanResult.global_index.toString(),
          blockIndex: scanResult.block_index.toString(),
          timestamp,
          value: BigInt(scanResult.value),
          tokenId: scanResult.token_id != null ? BigInt(scanResult.token_id) : 0n,
          keyImage: new Uint8Array(scanResult.key_image),
          subaddressIndex: scanResult.subaddress_index ?? 0,
          spent: false,
          spentAtBlock: '0',
          memo: scanResult.memo ?? null,
        })
      }
    } catch (err) {
      console.error('[fog] Failed to process TxOut result:', err)
    }
  }

  return owned
}

// ── Core: check key images for spent status ──

async function checkKeyImages(
  txOuts: OwnedTxOut[],
  signal?: AbortSignal,
): Promise<void> {
  if (txOuts.length === 0) return

  try {
    const conn = fogKeyImageConn()
    const keyImages = txOuts.map(txo => txo.keyImage)
    const checkRequest = encodeCheckKeyImagesRequest(keyImages)

    const responseBytes = await conn.encryptedCall(
      `${PATH_PREFIX}${PATHS.fogKeyImageCheck}`,
      checkRequest,
      new Uint8Array(0),
      { timeoutMs: QUERY_TIMEOUT_MS, signal },
    )
    const checkResponse = decodeCheckKeyImagesResponse(responseBytes)

    for (let i = 0; i < checkResponse.results.length && i < txOuts.length; i++) {
      const status = checkResponse.results[i].status
      const spentAt = checkResponse.results[i].spentAt
      const kiTimestamp = checkResponse.results[i].timestamp
      console.log(`[fog] keyImage[${i}]: ${toHex(txOuts[i].keyImage).slice(0, 16)}.., status=${status}, spentAt=${spentAt}, ts=${kiTimestamp}`)
      if (status === 'Spent') {
        txOuts[i].spent = true
        txOuts[i].spentAtBlock = spentAt
        // If TxOut had no timestamp, use the key image spent timestamp
        if (txOuts[i].timestamp === 0) {
          const ts = Number(kiTimestamp)
          if (ts > 0 && ts < 4294967295) txOuts[i].timestamp = ts
        }
      }
    }
  } catch (err) {
    console.warn('[fog] Key image check failed, treating all as unspent:', err)
  }
}

// ── Core: download missed blocks and view-key scan them ──

/**
 * Fetch actual block data for missed_block_ranges from the fog-block service,
 * then view-key scan every TxOut in those blocks to find ours.
 *
 * This is the MC reference client's fallback: when fog-ingest missed some blocks
 * (OMap eviction, server restarts, etc.), the server reports them as
 * missed_block_ranges. The client then downloads those blocks directly and
 * scans them brute-force.
 *
 * fog_ledger.FogBlockAPI/GetBlocks is a non-attested (plain gRPC) endpoint.
 */
async function fetchMissedBlocks(
  missedRanges: Array<{ startBlock: string; endBlock: string }>,
  viewKey: Uint8Array,
  spendKey: Uint8Array,
  signal?: AbortSignal,
): Promise<OwnedTxOut[]> {
  if (missedRanges.length === 0) return []

  const totalBlocks = missedRanges.reduce(
    (sum, r) => sum + (Number(r.endBlock) - Number(r.startBlock)), 0,
  )
  console.log(`[fog][MB] Fetching ${totalBlocks} missed block(s) across ${missedRanges.length} range(s)`)

  const requestBytes = encodeBlockRequest(missedRanges)

  // FogBlockAPI is non-attested — plain gRPC call through Envoy
  const response = await grpcFetch(
    `${PATH_PREFIX}${PATHS.fogBlockGetBlocks}`,
    requestBytes,
    { timeoutMs: QUERY_TIMEOUT_MS, signal },
  )
  const blockResponse = decodeBlockResponse(response.data)

  console.log(`[fog][MB] Got ${blockResponse.blocks.length} block(s) with TxOuts to scan`)

  const owned: OwnedTxOut[] = []

  for (const block of blockResponse.blocks) {
    console.log(`[fog][MB]   Block ${block.index}: ${block.outputs.length} TxOut(s)`)

    for (const txOut of block.outputs) {
      if (txOut.targetKey.length === 0 || txOut.publicKey.length === 0) continue

      try {
        const globalIndex = computeGlobalIndex(block, txOut, block.outputs)
        const txOutData: TxOutData = {
          target_key: txOut.targetKey,
          public_key: txOut.publicKey,
          masked_value: txOut.maskedValue,
          masked_token_id: txOut.maskedTokenId,
          commitment: txOut.commitment,
          global_index: BigInt(globalIndex),
          block_index: BigInt(block.index),
          e_memo: txOut.eMemoData.length > 0 ? txOut.eMemoData : undefined,
        }

        const scanResult = await scanTxOut(txOutData, viewKey, spendKey, NUM_SUBADDRESSES)

        if (scanResult.owned && scanResult.value != null && scanResult.key_image != null) {
          console.log(`[fog][MB]     ✓ OWNED in block ${block.index}, value=${Number(scanResult.value) / 1e12} MOB`)
          owned.push({
            globalIndex: scanResult.global_index.toString(),
            blockIndex: scanResult.block_index.toString(),
            timestamp: 0,
            value: BigInt(scanResult.value),
            tokenId: scanResult.token_id != null ? BigInt(scanResult.token_id) : 0n,
            keyImage: new Uint8Array(scanResult.key_image),
            subaddressIndex: scanResult.subaddress_index ?? 0,
            spent: false,
            spentAtBlock: '0',
            memo: scanResult.memo ?? null,
          })
        }
      } catch {
        // Not ours — expected for most TxOuts in the block
      }
    }
  }

  console.log(`[fog][MB] Found ${owned.length} owned TxOut(s) in missed blocks`)
  return owned
}

/** Compute approximate global index for a TxOut within a BlockData */
function computeGlobalIndex(block: BlockData, _txOut: { targetKey: number[] }, allOutputs: { targetKey: number[] }[]): string {
  // BlockData.global_txo_count is the cumulative count AFTER this block
  const firstGlobalIndex = BigInt(block.globalTxoCount) - BigInt(allOutputs.length)
  const idx = allOutputs.indexOf(_txOut)
  return (firstGlobalIndex + BigInt(idx >= 0 ? idx : 0)).toString()
}

/** Merge overlapping/adjacent missed block ranges and deduplicate */
function deduplicateMissedRanges(
  ranges: Array<{ startBlock: string; endBlock: string }>,
): Array<{ startBlock: string; endBlock: string }> {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => Number(a.startBlock) - Number(b.startBlock))
  const merged: Array<{ startBlock: string; endBlock: string }> = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (Number(sorted[i].startBlock) <= Number(last.endBlock)) {
      // Overlapping or adjacent — extend
      last.endBlock = String(Math.max(Number(last.endBlock), Number(sorted[i].endBlock)))
    } else {
      merged.push(sorted[i])
    }
  }
  return merged
}

// ── Main: two-phase fog sync (matches MC reference polling.rs) ──

/**
 * Full fog balance sync with progressive results.
 *
 * Uses MC's exponential search loop:
 *   Round 1: 1 key/RNG → Round 2: 2 keys/RNG → Round 3: 4 keys/RNG → ...
 *   Cap at 500/num_live_rngs. Dead RNGs drop out. Loop until all dead.
 *
 * @param onResult Called after each round with cumulative owned TxOuts (unspent-checked).
 *                 The UI can display a running balance using this.
 */
export async function syncFogBalance(
  account: WalletAccountKey,
  onProgress?: (progress: FogSyncProgress) => void,
  signal?: AbortSignal,
  onResult?: (partial: FogSyncResult) => void,
): Promise<FogSyncResult> {
  const viewKey = account.view_private_key
  const spendKey = account.spend_private_key

  // ─── Phase 1: Empty query → get RNG records ───
  onProgress?.({ phase: 'attesting' })
  onProgress?.({ phase: 'querying-rng' })

  const initResponse = await fogViewQuery([], 0, 0, signal)

  const decommissionedIds = new Set(
    (initResponse.decommissionedIngestInvocations ?? []).map(d => d.ingestInvocationId),
  )

  console.log(`[fog][P1] RNG records: ${initResponse.rngRecords.length}, ` +
    `highestProcessedBlock: ${initResponse.highestProcessedBlock}, ` +
    `decommissioned: ${decommissionedIds.size}, ` +
    `nextEvent: ${initResponse.nextStartFromUserEventId}`)

  if (initResponse.rngRecords.length === 0) {
    console.warn('[fog] 0 RNG records — account has never received via fog')
    onProgress?.({ phase: 'done' })
    return { ownedTxOuts: [], totalBalance: 0n, highestProcessedBlock: initResponse.highestProcessedBlock, syncedAt: Date.now() }
  }

  // ─── Build RNG cursors, separating active from decommissioned ───
  const activeCursors: RngCursor[] = []
  const decommissionedCursors: RngCursor[] = []

  for (const rng of initResponse.rngRecords) {
    if (rng.version !== 0) continue
    const cursor: RngCursor = { record: rng, nextIndex: 0n, dead: false }
    if (decommissionedIds.has(rng.ingestInvocationId)) {
      decommissionedCursors.push(cursor)
    } else {
      activeCursors.push(cursor)
    }
  }

  console.log(`[fog][P1] Active RNGs: ${activeCursors.length}, Decommissioned RNGs: ${decommissionedCursors.length}`)

  // Collect missed block ranges from all responses (init + queries)
  const allMissedBlockRanges: Array<{ startBlock: string; endBlock: string }> = [
    ...(initResponse.missedBlockRanges ?? []),
  ]
  if (allMissedBlockRanges.length > 0) {
    console.log(`[fog][P1] Initial missed_block_ranges: ${allMissedBlockRanges.length}`, allMissedBlockRanges)
  }

  // ─── Phase 2: Exponential search loop (active first, then decommissioned) ───
  const allOwnedTxOuts: OwnedTxOut[] = []
  let highestProcessedBlock = initResponse.highestProcessedBlock

  // Active first for fast balance, then scan decommissioned for history
  const rngBatches: { cursors: RngCursor[]; label: string }[] = []
  if (activeCursors.length > 0) {
    rngBatches.push({ cursors: activeCursors, label: 'active' })
  }
  if (decommissionedCursors.length > 0) {
    rngBatches.push({ cursors: decommissionedCursors, label: 'decommissioned' })
  }

  for (const batch of rngBatches) {
    const { cursors, label } = batch
    let requestMultiplier = 1
    let round = 0

    onProgress?.({ phase: 'querying-txos', detail: `${label}: ${cursors.length} RNG(s)` })
    console.log(`[fog][P2] Starting exponential search for ${label} RNGs (${cursors.length})`)

    while (true) {
      const liveCursors = cursors.filter(c => !c.dead)
      if (liveCursors.length === 0) break

      // Cap at 500 search keys total, spread across live RNGs
      const maxMultiplier = Math.max(Math.floor(MAX_SEARCH_KEYS_PER_QUERY / liveCursors.length), 1)
      requestMultiplier = Math.min(requestMultiplier, maxMultiplier)

      round++
      console.log(`[fog][P2] ${label} round ${round}: ${liveCursors.length} live RNGs, ${requestMultiplier} keys/RNG`)

      // Derive search keys for all live RNGs at their current cursor position
      onProgress?.({ phase: 'deriving-keys', detail: `${label} round ${round}` })
      const searchKeys: Uint8Array[] = []
      const keyToCursor = new Map<string, { cursor: RngCursor; offset: number }>()

      for (const cursor of liveCursors) {
        const result = await deriveKexRngSearchKeys(
          viewKey, spendKey,
          cursor.record.pubkey,
          cursor.nextIndex,
          requestMultiplier,
        )

        for (let ki = 0; ki < result.search_keys.length; ki++) {
          const key = new Uint8Array(result.search_keys[ki])
          searchKeys.push(key)
          keyToCursor.set(toHex(key), { cursor, offset: ki })
        }
      }

      if (searchKeys.length === 0) break

      // Query fog-view
      onProgress?.({ phase: 'querying-txos', detail: `${label} round ${round}: ${searchKeys.length} keys` })
      const queryResponse = await fogViewQuery(
        searchKeys,
        0x7FFFFFFF, // i64::MAX — we don't want more user events, just search results
        Number(highestProcessedBlock),
        signal,
      )

      // Track highest processed block (min across all responses, per MC spec)
      if (BigInt(queryResponse.highestProcessedBlock) < BigInt(highestProcessedBlock)) {
        highestProcessedBlock = queryResponse.highestProcessedBlock
      }

      // Collect missed block ranges from this response
      if (queryResponse.missedBlockRanges?.length > 0) {
        console.log(`[fog][P2]   ${label} round ${round}: ${queryResponse.missedBlockRanges.length} missed block range(s)`)
        allMissedBlockRanges.push(...queryResponse.missedBlockRanges)
      }

      // Count found results per cursor to determine advancement
      const foundPerCursor = new Map<RngCursor, number>()
      const foundResults = queryResponse.fixedTxOutSearchResults.filter(
        (r: FixedTxOutSearchResult) => r.resultCode === 1,
      )

      console.log(`[fog][P2]   ${label} round ${round}: ${foundResults.length} Found / ${queryResponse.fixedTxOutSearchResults.length} total`)

      // Map found results back to their cursors
      for (const result of foundResults) {
        const entry = keyToCursor.get(result.searchKey)
        if (entry) {
          foundPerCursor.set(entry.cursor, (foundPerCursor.get(entry.cursor) ?? 0) + 1)
        }
      }

      // Process found TxOuts
      if (foundResults.length > 0) {
        onProgress?.({ phase: 'scanning', detail: `${foundResults.length} TxOut(s)` })
        const newOwned = await processFoundResults(foundResults, viewKey, spendKey)
        if (newOwned.length > 0) {
          allOwnedTxOuts.push(...newOwned)

          // Check key images and emit progressive result
          onProgress?.({ phase: 'checking-key-images', detail: `${newOwned.length} new` })
          await checkKeyImages(newOwned, signal)

          const totalBalance = allOwnedTxOuts
            .filter(txo => !txo.spent && txo.tokenId === 0n)
            .reduce((sum, txo) => sum + txo.value, 0n)

          console.log(`[fog][P2]   Running balance: ${Number(totalBalance) / 1e12} MOB (${allOwnedTxOuts.length} owned, ${allOwnedTxOuts.filter(t => t.spent).length} spent)`)

          onResult?.({
            ownedTxOuts: [...allOwnedTxOuts],
            totalBalance,
            highestProcessedBlock,
            syncedAt: Date.now(),
          })
        }
      }

      // Advance cursors past found results; mark dead per MC reference:
      // An RNG is dead if it didn't advance by exactly request_multiplier
      // steps this round (i.e. fewer results found than keys requested).
      // On a miss we stay in place and let the doubled multiplier widen
      // the search window next round — this correctly handles any gaps
      // from OMap eviction without skipping entries.
      for (const cursor of liveCursors) {
        const foundCount = foundPerCursor.get(cursor) ?? 0
        if (foundCount > 0) {
          cursor.nextIndex += BigInt(foundCount)
        }
        // Dead if we got fewer results than requested (no advancement on miss)
        if (foundCount < requestMultiplier) {
          cursor.dead = true
          console.log(`[fog][P2]   RNG ${cursor.record.ingestInvocationId} dead (found ${foundCount}/${requestMultiplier})`)
        }
      }

      // Double multiplier for next round (exponential growth)
      requestMultiplier = Math.min(requestMultiplier * 2, maxMultiplier)
    }

    console.log(`[fog][P2] ${label} scan complete after ${round} round(s)`)
  }

  // ─── Phase 2b: Recover TxOuts from missed block ranges ───
  // Deduplicate missed ranges before fetching
  const dedupedRanges = deduplicateMissedRanges(allMissedBlockRanges)
  if (dedupedRanges.length > 0) {
    const totalMissedBlocks = dedupedRanges.reduce(
      (sum, r) => sum + (Number(r.endBlock) - Number(r.startBlock)), 0,
    )
    console.log(`[fog][MB] ${dedupedRanges.length} missed block range(s), ${totalMissedBlocks} total block(s)`)
    onProgress?.({ phase: 'scanning', detail: `recovering ${totalMissedBlocks} missed block(s)` })

    try {
      const missedOwned = await fetchMissedBlocks(dedupedRanges, viewKey, spendKey, signal)
      if (missedOwned.length > 0) {
        // Deduplicate against already-found TxOuts
        const existingIndices = new Set(allOwnedTxOuts.map(t => t.globalIndex))
        const newMissed = missedOwned.filter(t => !existingIndices.has(t.globalIndex))

        if (newMissed.length > 0) {
          allOwnedTxOuts.push(...newMissed)
          onProgress?.({ phase: 'checking-key-images', detail: `missed blocks: ${newMissed.length} new` })
          await checkKeyImages(newMissed, signal)

          const runningBalance = allOwnedTxOuts
            .filter(txo => !txo.spent && txo.tokenId === 0n)
            .reduce((sum, txo) => sum + txo.value, 0n)

          console.log(`[fog][MB] After missed blocks: ${Number(runningBalance) / 1e12} MOB (${allOwnedTxOuts.length} owned, ${allOwnedTxOuts.filter(t => t.spent).length} spent)`)

          onResult?.({
            ownedTxOuts: [...allOwnedTxOuts],
            totalBalance: runningBalance,
            highestProcessedBlock,
            syncedAt: Date.now(),
          })
        }
      }
    } catch (err) {
      console.warn('[fog][MB] Failed to fetch missed blocks (fog-block endpoint may be unavailable):', err)
    }
  } else {
    console.log('[fog][MB] No missed block ranges reported')
  }

  // ─── Final result ───
  const totalBalance = allOwnedTxOuts
    .filter(txo => !txo.spent && txo.tokenId === 0n)
    .reduce((sum, txo) => sum + txo.value, 0n)

  console.log(`[fog] FINAL: ${allOwnedTxOuts.length} owned TxOuts, ${Number(totalBalance) / 1e12} MOB`)
  for (const txo of allOwnedTxOuts) {
    console.log(`[fog]   idx=${txo.globalIndex}, ${Number(txo.value) / 1e12} MOB, subaddr=${txo.subaddressIndex}, spent=${txo.spent}`)
  }

  onProgress?.({ phase: 'done' })

  return {
    ownedTxOuts: allOwnedTxOuts,
    totalBalance,
    highestProcessedBlock,
    syncedAt: Date.now(),
  }
}

/**
 * Reset all attested connections (e.g. on network switch or wallet lock).
 */
export function resetFogConnections(): void {
  dropConnection('fog-view')
  dropConnection('fog-key-image')
}

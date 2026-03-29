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
  type QueryResponse,
  type RngRecord,
  type FixedTxOutSearchResult,
} from '../lib/mc-proto'
import {
  deriveKexRngSearchKeys,
  decryptFogCiphertext,
  scanTxOut,
  type WalletAccountKey,
  type TxOutData,
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
} as const

// Max subaddresses to scan for ownership (0 = default, 1 = change)
const NUM_SUBADDRESSES = 2n

// Timeout for query calls
const QUERY_TIMEOUT_MS = 90_000

// MC reference caps at 500 search keys per gRPC query
const MAX_SEARCH_KEYS_PER_QUERY = 500

// ── Types ──

export interface OwnedTxOut {
  globalIndex: string
  blockIndex: string
  value: bigint          // picoMOB
  tokenId: bigint
  keyImage: Uint8Array   // 32 bytes
  subaddressIndex: number
  spent: boolean
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
  /** True when this RNG has been exhausted (produced fewer hits than requested) */
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
        console.log(`[fog]     ✓ OWNED subaddr=${scanResult.subaddress_index}, value=${Number(scanResult.value) / 1e12} MOB`)
        owned.push({
          globalIndex: scanResult.global_index.toString(),
          blockIndex: scanResult.block_index.toString(),
          value: BigInt(scanResult.value),
          tokenId: scanResult.token_id != null ? BigInt(scanResult.token_id) : 0n,
          keyImage: new Uint8Array(scanResult.key_image),
          subaddressIndex: scanResult.subaddress_index ?? 0,
          spent: false,
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
      console.log(`[fog] keyImage[${i}]: ${toHex(txOuts[i].keyImage).slice(0, 16)}.., status=${status}, spentAt=${spentAt}`)
      if (status === 'Spent') {
        txOuts[i].spent = true
      }
    }
  } catch (err) {
    console.warn('[fog] Key image check failed, treating all as unspent:', err)
  }
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

      // Advance cursors past found results; mark dead if not fully advanced
      for (const cursor of liveCursors) {
        const foundCount = foundPerCursor.get(cursor) ?? 0
        cursor.nextIndex += BigInt(foundCount)
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

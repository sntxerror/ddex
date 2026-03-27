/**
 * Fog balance sync client for MobileCoin.
 *
 * Orchestrates the full flow:
 *   1. Attest with fog-view (Noise NX handshake)
 *   2. Query for RNG records (initial empty query)
 *   3. Derive KexRng search keys via WASM
 *   4. Query fog-view with search keys
 *   5. Decrypt found TxOuts via WASM fog ciphertext decryption
 *   6. Scan each TxOut for ownership and unmask amounts
 *   7. Check key images against fog-ledger for spent detection
 *   8. Sum unspent TxOuts = spendable balance
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

// How many search keys to generate per RNG record per batch
const SEARCH_KEY_BATCH_SIZE = 50

// Max subaddresses to scan for ownership (0 = default subaddress)
const NUM_SUBADDRESSES = 2n

// Timeout for query calls (fog queries can be slow)
const QUERY_TIMEOUT_MS = 90_000

// ── Types ──

export interface OwnedTxOut {
  globalIndex: string
  blockIndex: string
  value: bigint          // picoMOB
  tokenId: bigint
  keyImage: Uint8Array   // 32 bytes
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

// ── Helpers ──

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// ── Fog Client ──

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

/**
 * Full fog balance sync for a given account.
 *
 * This is the main entry point. It performs the entire flow from attestation
 * through to a final spendable balance.
 */
export async function syncFogBalance(
  account: WalletAccountKey,
  onProgress?: (progress: FogSyncProgress) => void,
  signal?: AbortSignal,
): Promise<FogSyncResult> {
  const viewKey = account.view_private_key
  const spendKey = account.spend_private_key
  const queryOpts = { timeoutMs: QUERY_TIMEOUT_MS, signal }

  // Phase 1: Initial query to get RNG records
  onProgress?.({ phase: 'attesting' })

  const conn = fogViewConn()
  let response: QueryResponse

  try {
    // Empty search keys query — returns RNG records and sync metadata
    const emptyRequest = encodeQueryRequest([])
    const aad = encodeQueryRequestAAD(0, 0)

    onProgress?.({ phase: 'querying-rng' })
    const responseBytes = await conn.encryptedCall(
      `${PATH_PREFIX}${PATHS.fogViewQuery}`,
      emptyRequest,
      aad,
      queryOpts,
    )
    response = decodeQueryResponse(responseBytes)
  } catch (err) {
    if (isAbortError(err)) throw err
    if (err instanceof GrpcError &&
      (err.code === GRPC_STATUS.DEADLINE_EXCEEDED || err.code === GRPC_STATUS.UNAVAILABLE)) {
      dropConnection('fog-view')
      // Retry once with fresh connection
      const retryConn = fogViewConn()
      const emptyRequest = encodeQueryRequest([])
      const aad = encodeQueryRequestAAD(0, 0)
      const responseBytes = await retryConn.encryptedCall(
        `${PATH_PREFIX}${PATHS.fogViewQuery}`,
        emptyRequest,
        aad,
        queryOpts,
      )
      response = decodeQueryResponse(responseBytes)
    } else {
      throw err
    }
  }

  if (response.rngRecords.length === 0) {
    // No RNG records = this account has never received through Fog
    console.warn('[fog] 0 RNG records — account has never received via fog (wrong key? wrong network?)')
    onProgress?.({ phase: 'done' })
    return {
      ownedTxOuts: [],
      totalBalance: 0n,
      highestProcessedBlock: response.highestProcessedBlock,
      syncedAt: Date.now(),
    }
  }

  // Phase 2: Derive search keys for each RNG record
  onProgress?.({ phase: 'deriving-keys', detail: `${response.rngRecords.length} RNG record(s)` })
  const allSearchKeys: Uint8Array[] = []
  const searchKeyToRng = new Map<string, RngRecord>()

  for (const rng of response.rngRecords) {
    if (rng.version !== 0) {
      console.warn(`[fog] Skipping RNG record with unsupported version ${rng.version}`)
      continue
    }

    const result = await deriveKexRngSearchKeys(
      viewKey,
      spendKey,
      rng.pubkey,
      0n,
      SEARCH_KEY_BATCH_SIZE,
    )

    for (const keyArr of result.search_keys) {
      const key = new Uint8Array(keyArr)
      allSearchKeys.push(key)
      const hex = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('')
      searchKeyToRng.set(hex, rng)
    }
  }

  if (allSearchKeys.length === 0) {
    onProgress?.({ phase: 'done' })
    return {
      ownedTxOuts: [],
      totalBalance: 0n,
      highestProcessedBlock: response.highestProcessedBlock,
      syncedAt: Date.now(),
    }
  }

  // Phase 3: Query fog-view with search keys (with retry on failure)
  onProgress?.({ phase: 'querying-txos', detail: `${allSearchKeys.length} search key(s)` })

  let queryResponse: QueryResponse
  const queryRequest = encodeQueryRequest(allSearchKeys)
  const queryAad = encodeQueryRequestAAD(
    Number(response.nextStartFromUserEventId),
    0,
  )

  try {
    const queryResponseBytes = await conn.encryptedCall(
      `${PATH_PREFIX}${PATHS.fogViewQuery}`,
      queryRequest,
      queryAad,
      queryOpts,
    )
    queryResponse = decodeQueryResponse(queryResponseBytes)
  } catch (err) {
    if (isAbortError(err)) throw err
    // Retry once with fresh connection on timeout/unavailable
    console.warn('[fog] Search key query failed, retrying with fresh connection:', err)
    dropConnection('fog-view')
    const retryConn = fogViewConn()
    const retryResponseBytes = await retryConn.encryptedCall(
      `${PATH_PREFIX}${PATHS.fogViewQuery}`,
      queryRequest,
      queryAad,
      queryOpts,
    )
    queryResponse = decodeQueryResponse(retryResponseBytes)
  }

  // Phase 4: Process found TxOuts
  onProgress?.({ phase: 'scanning', detail: `${queryResponse.fixedTxOutSearchResults.length} result(s)` })

  const ownedTxOuts: OwnedTxOut[] = []
  const foundResults = queryResponse.fixedTxOutSearchResults.filter(
    (r: FixedTxOutSearchResult) => r.resultCode === 1, // Found
  )

  for (let fi = 0; fi < foundResults.length; fi++) {
    const result = foundResults[fi]
    try {
      // Truncate ciphertext to actual payload length (FixedTxOutSearchResult
      // zero-pads to 255 bytes; the real VersionedCryptoBox is payloadLength bytes)
      const actualCiphertext = result.payloadLength > 0 && result.payloadLength < result.ciphertext.length
        ? result.ciphertext.slice(0, result.payloadLength)
        : result.ciphertext

      // Decrypt the fog ciphertext to get TxOutRecord proto bytes
      const plaintext = await decryptFogCiphertext(
        viewKey,
        spendKey,
        actualCiphertext,
      )

      // Decode TxOutRecord proto
      const record = decodeTxOutRecord(plaintext)

      // Build TxOutData for scan_tx_out
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

      // Scan for ownership and unmask amount
      const scanResult = await scanTxOut(
        txOutData,
        viewKey,
        spendKey,
        NUM_SUBADDRESSES,
      )
      if (scanResult.owned && scanResult.value != null && scanResult.key_image != null) {
        ownedTxOuts.push({
          globalIndex: scanResult.global_index.toString(),
          blockIndex: scanResult.block_index.toString(),
          value: BigInt(scanResult.value),
          tokenId: scanResult.token_id != null ? BigInt(scanResult.token_id) : 0n,
          keyImage: new Uint8Array(scanResult.key_image),
          spent: false,
        })
      }
    } catch (err) {
      console.error('[fog] Failed to process TxOut result:', err)
    }
  }

  // Phase 5: Check key images to determine spent status
  if (ownedTxOuts.length > 0) {
    onProgress?.({ phase: 'checking-key-images', detail: `${ownedTxOuts.length} key image(s)` })

    try {
      const keyImageConn = fogKeyImageConn()
      const keyImages = ownedTxOuts.map(txo => txo.keyImage)
      const checkRequest = encodeCheckKeyImagesRequest(keyImages)

      const checkResponseBytes = await keyImageConn.encryptedCall(
        `${PATH_PREFIX}${PATHS.fogKeyImageCheck}`,
        checkRequest,
        new Uint8Array(0),
        queryOpts,
      )
      const checkResponse = decodeCheckKeyImagesResponse(checkResponseBytes)

      // Match results back to owned TxOuts
      for (let i = 0; i < checkResponse.results.length && i < ownedTxOuts.length; i++) {
        if (checkResponse.results[i].status === 'Spent') {
          ownedTxOuts[i].spent = true
        }
      }
    } catch (err) {
      console.warn('[fog] Key image check failed, treating all as unspent:', err)
    }
  }

  // Phase 6: Sum unspent MOB (token_id = 0)
  const totalBalance = ownedTxOuts
    .filter(txo => !txo.spent && txo.tokenId === 0n)
    .reduce((sum, txo) => sum + txo.value, 0n)

  onProgress?.({ phase: 'done' })

  return {
    ownedTxOuts,
    totalBalance,
    highestProcessedBlock: queryResponse.highestProcessedBlock,
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

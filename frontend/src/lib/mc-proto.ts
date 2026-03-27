/**
 * Hand-rolled protobuf encoder/decoder for MobileCoin gRPC messages.
 *
 * Minimal, purpose-built encoders for attest and fog_view message types.
 * Wire types: 0=varint, 1=fixed64, 2=length-delimited, 5=fixed32
 */

// ── Low-level protobuf primitives ──

function writeVarint(buf: number[], value: number | bigint): void {
  let v = typeof value === 'bigint' ? value : BigInt(value)
  if (v < 0n) {
    v = v + (1n << 64n)
  }
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) byte |= 0x80
    buf.push(byte)
  } while (v > 0n)
}

function writeTag(buf: number[], fieldNumber: number, wireType: number): void {
  writeVarint(buf, (fieldNumber << 3) | wireType)
}

function writeLengthDelimited(buf: number[], fieldNumber: number, data: Uint8Array): void {
  writeTag(buf, fieldNumber, 2)
  writeVarint(buf, data.length)
  for (let i = 0; i < data.length; i++) buf.push(data[i])
}

function writeUvarint(buf: number[], fieldNumber: number, value: number | bigint): void {
  if (value === 0 || value === 0n) return
  writeTag(buf, fieldNumber, 0)
  writeVarint(buf, value)
}

// ── Protobuf reader ──

interface PbField {
  fieldNumber: number
  wireType: number
  data: Uint8Array
  varint?: bigint
  fixed64?: bigint
  fixed32?: number
}

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n
  let shift = 0n
  let p = pos
  while (p < buf.length) {
    const byte = buf[p]
    result |= BigInt(byte & 0x7f) << shift
    p++
    if ((byte & 0x80) === 0) break
    shift += 7n
  }
  return [result, p]
}

function parseFields(buf: Uint8Array): PbField[] {
  const fields: PbField[] = []
  let pos = 0
  while (pos < buf.length) {
    const [tag, newPos] = readVarint(buf, pos)
    pos = newPos
    const fieldNumber = Number(tag >> 3n)
    const wireType = Number(tag & 7n)

    if (wireType === 0) {
      const [varint, vPos] = readVarint(buf, pos)
      fields.push({ fieldNumber, wireType, data: new Uint8Array(0), varint })
      pos = vPos
    } else if (wireType === 1) {
      const dv = new DataView(buf.buffer, buf.byteOffset + pos, 8)
      fields.push({ fieldNumber, wireType, data: buf.slice(pos, pos + 8), fixed64: dv.getBigUint64(0, true) })
      pos += 8
    } else if (wireType === 2) {
      const [len, lPos] = readVarint(buf, pos)
      const length = Number(len)
      pos = lPos
      fields.push({ fieldNumber, wireType, data: buf.slice(pos, pos + length) })
      pos += length
    } else if (wireType === 5) {
      const dv = new DataView(buf.buffer, buf.byteOffset + pos, 4)
      fields.push({ fieldNumber, wireType, data: buf.slice(pos, pos + 4), fixed32: dv.getUint32(0, true) })
      pos += 4
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${fieldNumber}`)
    }
  }
  return fields
}

// ── attest.AuthMessage { bytes data = 1 } ──

export function encodeAuthMessage(data: Uint8Array): Uint8Array {
  const buf: number[] = []
  writeLengthDelimited(buf, 1, data)
  return new Uint8Array(buf)
}

export function decodeAuthMessage(buf: Uint8Array): Uint8Array {
  for (const f of parseFields(buf)) {
    if (f.fieldNumber === 1 && f.wireType === 2) return f.data
  }
  throw new Error('AuthMessage: missing data field')
}

// ── attest.Message { bytes aad=1; bytes channel_id=2; bytes data=3 } ──

export function encodeAttestMessage(aad: Uint8Array, channelId: Uint8Array, data: Uint8Array): Uint8Array {
  const buf: number[] = []
  writeLengthDelimited(buf, 1, aad)
  writeLengthDelimited(buf, 2, channelId)
  writeLengthDelimited(buf, 3, data)
  return new Uint8Array(buf)
}

export function decodeAttestMessage(buf: Uint8Array): { aad: Uint8Array; channelId: Uint8Array; data: Uint8Array } {
  let aad: Uint8Array = new Uint8Array(0)
  let channelId: Uint8Array = new Uint8Array(0)
  let data: Uint8Array = new Uint8Array(0)
  for (const f of parseFields(buf)) {
    if (f.fieldNumber === 1 && f.wireType === 2) aad = new Uint8Array(f.data)
    if (f.fieldNumber === 2 && f.wireType === 2) channelId = new Uint8Array(f.data)
    if (f.fieldNumber === 3 && f.wireType === 2) data = new Uint8Array(f.data)
  }
  return { aad, channelId, data }
}

// ── fog_view.QueryRequest { repeated bytes get_txos = 1 } ──

export function encodeQueryRequest(searchKeys: Uint8Array[]): Uint8Array {
  const buf: number[] = []
  for (const key of searchKeys) {
    writeLengthDelimited(buf, 1, key)
  }
  return new Uint8Array(buf)
}

// ── fog_view.QueryRequestAAD { int64 start_from_user_event_id=1; uint64 start_from_block_index=2 } ──

export function encodeQueryRequestAAD(startFromUserEventId: number, startFromBlockIndex: number): Uint8Array {
  const buf: number[] = []
  writeUvarint(buf, 1, startFromUserEventId)
  writeUvarint(buf, 2, startFromBlockIndex)
  return new Uint8Array(buf)
}

// ── fog_view.QueryResponse (decoded) ──

export interface FixedTxOutSearchResult {
  searchKey: string       // hex
  resultCode: number
  ciphertext: Uint8Array
  payloadLength: number
}

export interface RngRecord {
  ingestInvocationId: string
  pubkey: Uint8Array      // 32-byte compressed Ristretto
  version: number
  startBlock: string
}

export interface DecommissionedIngest {
  ingestInvocationId: string
  lastIngestedBlock: string
}

export interface QueryResponse {
  highestProcessedBlock: string
  nextStartFromUserEventId: string
  missedBlockRanges: Array<{ startBlock: string; endBlock: string }>
  rngRecords: RngRecord[]
  decommissionedIngestInvocations: DecommissionedIngest[]
  fixedTxOutSearchResults: FixedTxOutSearchResult[]
  lastKnownBlockCount: string
  lastKnownBlockCumulativeTxoCount: string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function decodeRngRecord(data: Uint8Array): RngRecord {
  const fields = parseFields(data)
  let ingestInvocationId = '0'
  let pubkey = new Uint8Array(0)
  let version = 0
  let startBlock = '0'

  for (const f of fields) {
    if (f.fieldNumber === 1) ingestInvocationId = (f.varint ?? 0n).toString()
    if (f.fieldNumber === 2 && f.wireType === 2) {
      // KexRngPubkey submessage { bytes pubkey=1; uint32 version=2 }
      const sub = parseFields(f.data)
      for (const sf of sub) {
        if (sf.fieldNumber === 1 && sf.wireType === 2) pubkey = new Uint8Array(sf.data)
        if (sf.fieldNumber === 2) version = Number(sf.varint ?? 0n)
      }
    }
    if (f.fieldNumber === 3) startBlock = (f.varint ?? 0n).toString()
  }
  return { ingestInvocationId, pubkey, version, startBlock }
}

function decodeFixedTxOutSearchResult(data: Uint8Array): FixedTxOutSearchResult {
  const fields = parseFields(data)
  let searchKey = ''
  let resultCode = 0
  let ciphertext = new Uint8Array(0)
  let payloadLength = 0
  for (const f of fields) {
    if (f.fieldNumber === 1 && f.wireType === 2) searchKey = bytesToHex(f.data)
    if (f.fieldNumber === 2 && f.wireType === 5) resultCode = f.fixed32 ?? 0
    if (f.fieldNumber === 3 && f.wireType === 2) ciphertext = new Uint8Array(f.data)
    if (f.fieldNumber === 4 && f.wireType === 5) payloadLength = f.fixed32 ?? 0
  }
  return { searchKey, resultCode, ciphertext, payloadLength }
}

function decodeBlockRange(data: Uint8Array): { startBlock: string; endBlock: string } {
  const fields = parseFields(data)
  let startBlock = '0'
  let endBlock = '0'
  for (const f of fields) {
    if (f.fieldNumber === 1) startBlock = (f.varint ?? 0n).toString()
    if (f.fieldNumber === 2) endBlock = (f.varint ?? 0n).toString()
  }
  return { startBlock, endBlock }
}

export function decodeQueryResponse(buf: Uint8Array): QueryResponse {
  const fields = parseFields(buf)
  const result: QueryResponse = {
    highestProcessedBlock: '0',
    nextStartFromUserEventId: '0',
    missedBlockRanges: [],
    rngRecords: [],
    decommissionedIngestInvocations: [],
    fixedTxOutSearchResults: [],
    lastKnownBlockCount: '0',
    lastKnownBlockCumulativeTxoCount: '0',
  }

  for (const f of fields) {
    switch (f.fieldNumber) {
      case 1: result.highestProcessedBlock = (f.varint ?? 0n).toString(); break
      case 3: result.nextStartFromUserEventId = (f.varint ?? 0n).toString(); break
      case 4: result.missedBlockRanges.push(decodeBlockRange(f.data)); break
      case 5: result.rngRecords.push(decodeRngRecord(f.data)); break
      case 6: {
        const sub = parseFields(f.data)
        let id = '0', lb = '0'
        for (const sf of sub) {
          if (sf.fieldNumber === 1) id = (sf.varint ?? 0n).toString()
          if (sf.fieldNumber === 2) lb = (sf.varint ?? 0n).toString()
        }
        result.decommissionedIngestInvocations.push({ ingestInvocationId: id, lastIngestedBlock: lb })
        break
      }
      case 8: result.lastKnownBlockCount = (f.varint ?? 0n).toString(); break
      case 9: result.lastKnownBlockCumulativeTxoCount = (f.varint ?? 0n).toString(); break
      case 10: result.fixedTxOutSearchResults.push(decodeFixedTxOutSearchResult(f.data)); break
    }
  }
  return result
}

// ── TxOutRecord decoder (from decrypted fog ciphertext) ──

export interface TxOutRecordFields {
  txOutAmountCommitmentData: Uint8Array
  txOutAmountMaskedValue: bigint
  txOutAmountMaskedTokenId: Uint8Array
  txOutTargetKeyData: Uint8Array
  txOutPublicKeyData: Uint8Array
  txOutEMemoData: Uint8Array
  blockIndex: bigint
  timestampBlockIndex: bigint
  globalIndex: bigint
}

export function decodeTxOutRecord(buf: Uint8Array): TxOutRecordFields {
  const fields = parseFields(buf)
  const result: TxOutRecordFields = {
    txOutAmountCommitmentData: new Uint8Array(0),
    txOutAmountMaskedValue: 0n,
    txOutAmountMaskedTokenId: new Uint8Array(0),
    txOutTargetKeyData: new Uint8Array(0),
    txOutPublicKeyData: new Uint8Array(0),
    txOutEMemoData: new Uint8Array(0),
    blockIndex: 0n,
    timestampBlockIndex: 0n,
    globalIndex: 0n,
  }

  for (const f of fields) {
    switch (f.fieldNumber) {
      case 1:
        if (f.wireType === 2) result.txOutAmountCommitmentData = f.data
        break
      case 2:
        if (f.wireType === 1) result.txOutAmountMaskedValue = f.fixed64 ?? 0n
        break
      case 3:
        if (f.wireType === 2) result.txOutTargetKeyData = f.data
        break
      case 4:
        if (f.wireType === 2) result.txOutPublicKeyData = f.data
        break
      case 5:
        if (f.wireType === 1) result.globalIndex = f.fixed64 ?? 0n
        break
      case 6:
        if (f.wireType === 1) result.blockIndex = f.fixed64 ?? 0n
        break
      case 7:
        if (f.wireType === 1) result.timestampBlockIndex = f.fixed64 ?? 0n
        break
      case 8:
        // tx_out_amount_commitment_data_crc32 (fixed32) — skip for now
        break
      case 9:
        if (f.wireType === 2) result.txOutEMemoData = f.data
        break
      case 10:
        // tx_out_amount_masked_token_id_v1 (oneof)
        if (f.wireType === 2) result.txOutAmountMaskedTokenId = f.data
        break
      case 11:
        // tx_out_amount_masked_token_id_v2 (oneof)
        if (f.wireType === 2) result.txOutAmountMaskedTokenId = f.data
        break
    }
  }
  return result
}

// ── fog_ledger.CheckKeyImagesRequest ──

export function encodeCheckKeyImagesRequest(keyImages: Uint8Array[]): Uint8Array {
  const buf: number[] = []
  for (const ki of keyImages) {
    // KeyImageQuery { KeyImage key_image=1; fixed64 start_block=2 }
    // KeyImage { bytes data=1 }
    const inner: number[] = []
    const kiMsg: number[] = []
    writeLengthDelimited(kiMsg, 1, ki)
    writeLengthDelimited(inner, 1, new Uint8Array(kiMsg))
    writeLengthDelimited(buf, 1, new Uint8Array(inner))
  }
  return new Uint8Array(buf)
}

export interface KeyImageResult {
  keyImage: string   // hex
  status: 'Spent' | 'NotSpent' | 'Unknown'
  spentAt: string
}

export interface CheckKeyImagesResponse {
  numBlocks: string
  globalTxoCount: string
  results: KeyImageResult[]
}

function decodeKeyImageResult(data: Uint8Array): KeyImageResult {
  const fields = parseFields(data)
  let keyImage = ''
  let spentAt = '0'
  let resultCode = 0

  for (const f of fields) {
    if (f.fieldNumber === 1 && f.wireType === 2) {
      const sub = parseFields(f.data)
      for (const sf of sub) {
        if (sf.fieldNumber === 1 && sf.wireType === 2) keyImage = bytesToHex(sf.data)
      }
    }
    if (f.fieldNumber === 2 && f.wireType === 1) spentAt = (f.fixed64 ?? 0n).toString()
    if (f.fieldNumber === 5 && f.wireType === 5) resultCode = f.fixed32 ?? 0
  }

  return {
    keyImage,
    status: resultCode === 1 ? 'Spent' : resultCode === 2 ? 'NotSpent' : 'Unknown',
    spentAt,
  }
}

export function decodeCheckKeyImagesResponse(buf: Uint8Array): CheckKeyImagesResponse {
  const fields = parseFields(buf)
  const result: CheckKeyImagesResponse = {
    numBlocks: '0',
    globalTxoCount: '0',
    results: [],
  }

  for (const f of fields) {
    switch (f.fieldNumber) {
      case 1: result.numBlocks = (f.varint ?? 0n).toString(); break
      case 2: result.globalTxoCount = (f.varint ?? 0n).toString(); break
      case 3: result.results.push(decodeKeyImageResult(f.data)); break
    }
  }
  return result
}

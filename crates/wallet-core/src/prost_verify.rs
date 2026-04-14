//! Minimal MobileCoin Tx types for prost decode verification.
//!
//! These mirror the MC consensus enclave's prost-generated types.
//! Used to verify that our hand-rolled protobuf encoding produces
//! bytes that prost can successfully decode — the same decoder
//! the enclave uses via `mc_util_serial::decode::<Tx>(&tx_bytes)`.

use prost::Message;

#[derive(Clone, Message)]
pub struct CompressedRistretto {
    #[prost(bytes, tag = "1")]
    pub data: Vec<u8>,
}

#[derive(Clone, Message)]
pub struct CurveScalar {
    #[prost(bytes, tag = "1")]
    pub data: Vec<u8>,
}

#[derive(Clone, Message)]
pub struct KeyImage {
    #[prost(bytes, tag = "1")]
    pub data: Vec<u8>,
}

#[derive(Clone, Message)]
pub struct EncryptedFogHint {
    #[prost(bytes, tag = "1")]
    pub data: Vec<u8>,
}

#[derive(Clone, Message)]
pub struct EncryptedMemo {
    #[prost(bytes, tag = "1")]
    pub data: Vec<u8>,
}

#[derive(Clone, Message)]
pub struct TxOutMembershipHash {
    #[prost(bytes, tag = "1")]
    pub data: Vec<u8>,
}

#[derive(Clone, Message)]
pub struct Range {
    #[prost(uint64, tag = "1")]
    pub from: u64,
    #[prost(uint64, tag = "2")]
    pub to: u64,
}

#[derive(Clone, Message)]
pub struct TxOutMembershipElement {
    #[prost(message, required, tag = "1")]
    pub range: Range,
    #[prost(message, required, tag = "2")]
    pub hash: TxOutMembershipHash,
}

#[derive(Clone, Message)]
pub struct TxOutMembershipProof {
    #[prost(uint64, tag = "1")]
    pub index: u64,
    #[prost(uint64, tag = "2")]
    pub highest_index: u64,
    #[prost(message, repeated, tag = "3")]
    pub elements: Vec<TxOutMembershipElement>,
}

#[derive(Clone, Message)]
pub struct MaskedAmountV1 {
    #[prost(message, required, tag = "1")]
    pub commitment: CompressedRistretto,
    #[prost(fixed64, tag = "2")]
    pub masked_value: u64,
    #[prost(bytes, tag = "3")]
    pub masked_token_id: Vec<u8>,
}

#[derive(Clone, Message)]
pub struct MaskedAmountV2 {
    #[prost(message, required, tag = "1")]
    pub commitment: CompressedRistretto,
    #[prost(fixed64, tag = "2")]
    pub masked_value: u64,
    #[prost(bytes, tag = "3")]
    pub masked_token_id: Vec<u8>,
}

#[derive(Clone, prost::Oneof)]
pub enum MaskedAmount {
    #[prost(message, tag = "1")]
    V1(MaskedAmountV1),
    #[prost(message, tag = "6")]
    V2(MaskedAmountV2),
}

#[derive(Clone, Message)]
pub struct TxOut {
    #[prost(oneof = "MaskedAmount", tags = "1, 6")]
    pub masked_amount: Option<MaskedAmount>,
    #[prost(message, required, tag = "2")]
    pub target_key: CompressedRistretto,
    #[prost(message, required, tag = "3")]
    pub public_key: CompressedRistretto,
    #[prost(message, required, tag = "4")]
    pub e_fog_hint: EncryptedFogHint,
    #[prost(message, optional, tag = "5")]
    pub e_memo: Option<EncryptedMemo>,
}

#[derive(Clone, Message)]
pub struct InputRules {
    #[prost(message, repeated, tag = "1")]
    pub required_outputs: Vec<TxOut>,
    #[prost(fixed64, tag = "2")]
    pub max_tombstone_block: u64,
    #[prost(bytes, repeated, tag = "3")]
    pub partial_fill_outputs: Vec<Vec<u8>>,
    #[prost(bytes, optional, tag = "4")]
    pub partial_fill_change: Option<Vec<u8>>,
    #[prost(fixed64, tag = "5")]
    pub min_partial_fill_value: u64,
}

#[derive(Clone, Message)]
pub struct TxIn {
    #[prost(message, repeated, tag = "1")]
    pub ring: Vec<TxOut>,
    #[prost(message, repeated, tag = "2")]
    pub proofs: Vec<TxOutMembershipProof>,
    #[prost(message, optional, tag = "3")]
    pub input_rules: Option<InputRules>,
}

#[derive(Clone, Message)]
pub struct TxPrefix {
    #[prost(message, repeated, tag = "1")]
    pub inputs: Vec<TxIn>,
    #[prost(message, repeated, tag = "2")]
    pub outputs: Vec<TxOut>,
    #[prost(uint64, tag = "3")]
    pub fee: u64,
    #[prost(uint64, tag = "4")]
    pub tombstone_block: u64,
    #[prost(fixed64, tag = "5")]
    pub fee_token_id: u64,
}

#[derive(Clone, Message)]
pub struct RingMlsag {
    #[prost(message, required, tag = "1")]
    pub c_zero: CurveScalar,
    #[prost(message, repeated, tag = "2")]
    pub responses: Vec<CurveScalar>,
    #[prost(message, required, tag = "3")]
    pub key_image: KeyImage,
}

#[derive(Clone, Message)]
pub struct SignatureRctBulletproofs {
    #[prost(message, repeated, tag = "1")]
    pub ring_signatures: Vec<RingMlsag>,
    #[prost(message, repeated, tag = "2")]
    pub pseudo_output_commitments: Vec<CompressedRistretto>,
    #[prost(bytes, tag = "3")]
    pub range_proof_bytes: Vec<u8>,
    #[prost(bytes, repeated, tag = "4")]
    pub range_proofs: Vec<Vec<u8>>,
    #[prost(fixed64, repeated, packed = "true", tag = "5")]
    pub pseudo_output_token_ids: Vec<u64>,
    #[prost(fixed64, repeated, packed = "true", tag = "6")]
    pub output_token_ids: Vec<u64>,
}

#[derive(Clone, Message)]
pub struct Tx {
    #[prost(message, required, tag = "1")]
    pub prefix: TxPrefix,
    #[prost(message, required, tag = "2")]
    pub signature: SignatureRctBulletproofs,
    #[prost(bytes, tag = "3")]
    pub fee_map_digest: Vec<u8>,
}

/// Decode tx_bytes with prost (same decoder as MC enclave) and re-encode
/// to produce canonical bytes. This normalizes wire types, field ordering,
/// default value presence, etc. — exactly what kyoto's fog-proxy does via
/// protobufjs decode+re-encode.
pub fn canonicalize_tx_bytes(tx_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let tx = Tx::decode(tx_bytes).map_err(|e| format!("prost decode failed: {}", e))?;
    let mut canonical = Vec::with_capacity(tx_bytes.len());
    tx.encode(&mut canonical).map_err(|e| format!("prost encode failed: {}", e))?;

    if canonical.len() != tx_bytes.len() {
        web_sys::console::warn_1(&format!(
            "[prost] canonicalize: size changed {} -> {} bytes",
            tx_bytes.len(), canonical.len()
        ).into());
    }

    let sig = &tx.signature;
    web_sys::console::log_1(&format!(
        "[prost] Canonicalized OK: {} inputs, {} outputs, fee={}, tombstone={}, \
         ring_sigs={}, pseudo_outputs={}, range_proofs={}, \
         pseudo_token_ids={:?}, output_token_ids={:?}",
        tx.prefix.inputs.len(),
        tx.prefix.outputs.len(),
        tx.prefix.fee,
        tx.prefix.tombstone_block,
        sig.ring_signatures.len(),
        sig.pseudo_output_commitments.len(),
        sig.range_proofs.len(),
        sig.pseudo_output_token_ids,
        sig.output_token_ids,
    ).into());

    Ok(canonical)
}

/// Verify that tx_bytes can be decoded by prost (same as MC enclave).
/// Logs the result via web_sys::console.
#[allow(dead_code)]
pub fn verify_prost_decode(tx_bytes: &[u8]) -> Result<(), String> {
    match Tx::decode(tx_bytes) {
        Ok(tx) => {
            let sig = &tx.signature;
            web_sys::console::log_1(&format!(
                "[prost] Decode OK: {} inputs, {} outputs, fee={}, tombstone={}, \
                 ring_sigs={}, pseudo_outputs={}, range_proofs={}, \
                 pseudo_token_ids={:?}, output_token_ids={:?}",
                tx.prefix.inputs.len(),
                tx.prefix.outputs.len(),
                tx.prefix.fee,
                tx.prefix.tombstone_block,
                sig.ring_signatures.len(),
                sig.pseudo_output_commitments.len(),
                sig.range_proofs.len(),
                sig.pseudo_output_token_ids,
                sig.output_token_ids,
            ).into());
            Ok(())
        }
        Err(e) => {
            // Try to decode just the TxPrefix to narrow down the error
            let prefix_result = try_decode_prefix(tx_bytes);
            web_sys::console::log_1(&format!(
                "[prost] DECODE FAILED: {}. Prefix sub-decode: {}",
                e, prefix_result,
            ).into());
            Err(format!("prost decode failed: {}", e))
        }
    }
}

/// Helper: try to extract and decode just the TxPrefix from the outer Tx.
#[allow(dead_code)]
fn try_decode_prefix(tx_bytes: &[u8]) -> String {
    // Tx field 1 = TxPrefix. Extract it manually.
    let mut pos = 0;
    while pos < tx_bytes.len() {
        let (tag, new_pos) = decode_varint(tx_bytes, pos);
        pos = new_pos;
        let field_number = tag >> 3;
        let wire_type = tag & 7;

        if wire_type == 2 {
            let (len, new_pos) = decode_varint(tx_bytes, pos);
            pos = new_pos;
            let end = pos + len as usize;
            if end > tx_bytes.len() {
                return format!("truncated field {} at pos {}", field_number, pos);
            }
            if field_number == 1 {
                // Try decoding as TxPrefix
                match TxPrefix::decode(&tx_bytes[pos..end]) {
                    Ok(p) => return format!(
                        "TxPrefix OK: {} inputs, {} outputs",
                        p.inputs.len(), p.outputs.len()
                    ),
                    Err(e) => return format!("TxPrefix FAILED: {}", e),
                }
            }
            pos = end;
        } else if wire_type == 0 {
            let (_, new_pos) = decode_varint(tx_bytes, pos);
            pos = new_pos;
        } else if wire_type == 1 {
            pos += 8;
        } else if wire_type == 5 {
            pos += 4;
        } else {
            return format!("unknown wire type {} at field {}", wire_type, field_number);
        }
    }
    "TxPrefix field not found".to_string()
}

#[allow(dead_code)]
fn decode_varint(buf: &[u8], mut pos: usize) -> (u64, usize) {
    let mut value = 0u64;
    let mut shift = 0;
    while pos < buf.len() {
        let b = buf[pos];
        value |= ((b & 0x7f) as u64) << shift;
        pos += 1;
        if b & 0x80 == 0 { break; }
        shift += 7;
    }
    (value, pos)
}

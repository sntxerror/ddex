//! Merlin transcript-based hashing matching MobileCoin's `mc-crypto-digestible`.
//!
//! MobileCoin computes TxPrefix hash using Merlin transcripts with specific
//! domain separators and type annotations. This module replicates the exact
//! protocol so our MLSAG signatures verify against the enclave's hash.
//!
//! Reference: mobilecoin/crypto/digestible/src/lib.rs

use merlin::Transcript;

// Domain separators from mc-crypto-digestible
const PRIMITIVE: &[u8] = b"prim";
const SEQUENCE: &[u8] = b"seq";
const AGGREGATE: &[u8] = b"agg";
const AGGREGATE_END: &[u8] = b"agg-end";
#[allow(dead_code)]
const VARIANT: &[u8] = b"var";
#[allow(dead_code)]
const NONE: &[u8] = b"";

/// Wrapper around Merlin transcript matching MobileCoin's DigestTranscript.
pub(crate) struct McDigest {
    transcript: Transcript,
}

impl McDigest {
    pub fn new() -> Self {
        Self {
            transcript: Transcript::new(b"digestible"),
        }
    }

    /// Create with a custom transcript label (for extended message / TxSummary layers).
    pub fn with_label(label: &'static [u8]) -> Self {
        Self {
            transcript: Transcript::new(label),
        }
    }

    /// Extract the 32-byte digest.
    pub fn finalize(mut self) -> [u8; 32] {
        let mut output = [0u8; 32];
        self.transcript.challenge_bytes(b"digest32", &mut output);
        output
    }

    // ── Low-level append (maps to Merlin::append_message) ──

    fn append(&mut self, label: &'static [u8], data: &[u8]) {
        self.transcript.append_message(label, data);
    }

    // ── AST node operations ──

    // Note: Merlin's append_message requires &'static [u8] for labels.
    // All our context/type_name strings are compile-time constants.
    // For the rare dynamic case (MaskedAmount type name), we use raw_append.

    fn raw_append(&mut self, label: &[u8], data: &[u8]) {
        // Merlin internally copies the label, so we can safely transmute lifetime
        // for dynamic strings that we know are valid for the duration of the call.
        // Safety: Merlin only uses the label during this call (for STROBE absorb).
        unsafe {
            let static_label: &'static [u8] = core::mem::transmute(label);
            self.transcript.append_message(static_label, data);
        }
    }

    pub fn agg_open(&mut self, context: &'static [u8], type_name: &[u8]) {
        self.append(context, AGGREGATE);
        self.raw_append(b"name", type_name);
    }

    pub fn agg_close(&mut self, context: &'static [u8], type_name: &[u8]) {
        self.append(context, AGGREGATE_END);
        self.raw_append(b"name", type_name);
    }

    pub fn seq_header(&mut self, context: &'static [u8], len: usize) {
        self.append(context, SEQUENCE);
        self.append(b"len", &(len as u64).to_le_bytes());
    }

    #[allow(dead_code)]
    pub fn var_header(&mut self, context: &'static [u8], type_name: &[u8], which: u32) {
        self.append(context, VARIANT);
        self.raw_append(b"name", type_name);
        self.append(b"which", &which.to_le_bytes());
    }

    #[allow(dead_code)]
    pub fn none(&mut self, context: &'static [u8]) {
        self.append(context, NONE);
    }

    pub fn primitive(&mut self, context: &'static [u8], type_name: &'static [u8], data: &[u8]) {
        self.append(context, PRIMITIVE);
        self.append(type_name, data);
    }

    // ── Typed helpers ──

    pub fn ristretto(&mut self, context: &'static [u8], data: &[u8]) {
        self.primitive(context, b"ristretto", data);
    }

    pub fn uint64(&mut self, context: &'static [u8], value: u64) {
        self.primitive(context, b"uint", &value.to_le_bytes());
    }

    /// Append bytes primitive (used for EncryptedFogHint, EncryptedMemo, etc.)
    pub fn bytes_primitive(&mut self, context: &'static [u8], data: &[u8]) {
        self.primitive(context, b"bytes", data);
    }

    /// Append a uint64 only if non-zero (matches allow_omit behavior for uint).
    /// Note: u64's default allow_omit does NOT skip — it always appends.
    /// But some types (bytes, Option) do skip on empty/None.
    pub fn uint64_always(&mut self, context: &'static [u8], value: u64) {
        self.uint64(context, value);
    }

    /// Append bytes only if non-empty (matches allow_omit for Vec<u8>).
    pub fn bytes_allow_omit(&mut self, context: &'static [u8], data: &[u8]) {
        if !data.is_empty() {
            self.bytes_primitive(context, data);
        }
    }

    /// Append a bool primitive (type name "bool", data = 1 byte: 0x00/0x01).
    pub fn bool_primitive(&mut self, context: &'static [u8], value: bool) {
        self.primitive(context, b"bool", &[value as u8]);
    }
}

// ── Protobuf wire format parser ──

/// Parse a varint from protobuf bytes, returning (value, bytes_consumed).
pub(crate) fn parse_varint(data: &[u8]) -> Option<(u64, usize)> {
    let mut value: u64 = 0;
    let mut shift = 0;
    for (i, &byte) in data.iter().enumerate() {
        value |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((value, i + 1));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

/// A parsed protobuf field.
pub(crate) struct ProtoField<'a> {
    pub field_number: u32,
    #[allow(dead_code)]
    pub wire_type: u8,
    pub data: &'a [u8],       // For length-delimited (wire type 2)
    pub varint_value: u64,    // For varint (wire type 0)
    pub fixed64_value: u64,   // For fixed64 (wire type 1)
}

/// Parse all fields from a protobuf message.
pub(crate) fn parse_proto_fields(data: &[u8]) -> Vec<ProtoField<'_>> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while pos < data.len() {
        let (tag, consumed) = match parse_varint(&data[pos..]) {
            Some(v) => v,
            None => break,
        };
        pos += consumed;

        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 0x07) as u8;

        match wire_type {
            0 => {
                // Varint
                let (value, consumed) = match parse_varint(&data[pos..]) {
                    Some(v) => v,
                    None => break,
                };
                pos += consumed;
                fields.push(ProtoField {
                    field_number,
                    wire_type,
                    data: &[],
                    varint_value: value,
                    fixed64_value: 0,
                });
            }
            1 => {
                // Fixed64
                if pos + 8 > data.len() {
                    break;
                }
                let value = u64::from_le_bytes(data[pos..pos + 8].try_into().unwrap());
                pos += 8;
                fields.push(ProtoField {
                    field_number,
                    wire_type,
                    data: &[],
                    varint_value: 0,
                    fixed64_value: value,
                });
            }
            2 => {
                // Length-delimited
                let (len, consumed) = match parse_varint(&data[pos..]) {
                    Some(v) => v,
                    None => break,
                };
                pos += consumed;
                let len = len as usize;
                if pos + len > data.len() {
                    break;
                }
                fields.push(ProtoField {
                    field_number,
                    wire_type,
                    data: &data[pos..pos + len],
                    varint_value: 0,
                    fixed64_value: 0,
                });
                pos += len;
            }
            5 => {
                // Fixed32
                if pos + 4 > data.len() {
                    break;
                }
                pos += 4;
                // Skip fixed32 fields (not used in TxPrefix tree)
            }
            _ => break,
        }
    }

    fields
}

/// Helper to find a field by number in parsed proto fields.
pub(crate) fn find_field<'a>(fields: &'a [ProtoField<'a>], field_number: u32) -> Option<&'a ProtoField<'a>> {
    fields.iter().find(|f| f.field_number == field_number)
}

/// Helper to find all fields with a given number (for repeated fields).
pub(crate) fn find_all_fields<'a>(fields: &'a [ProtoField<'a>], field_number: u32) -> Vec<&'a ProtoField<'a>> {
    fields.iter().filter(|f| f.field_number == field_number).collect()
}

/// Extract the inner `data` bytes from a CompressedRistretto/CompressedCommitment message.
/// These are wrapped as: message CompressedRistretto { bytes data = 1; }
fn extract_ristretto_bytes(msg_bytes: &[u8]) -> Vec<u8> {
    let fields = parse_proto_fields(msg_bytes);
    find_field(&fields, 1).map(|f| f.data.to_vec()).unwrap_or_default()
}

// ── TxPrefix hash computation ──

/// Digest a TxOut from parsed protobuf bytes into the Merlin transcript.
///
/// TxOut proto fields:
///   oneof masked_amount { MaskedAmountV1 = 1, MaskedAmountV2 = 6 }
///   CompressedRistretto target_key = 2
///   CompressedRistretto public_key = 3
///   EncryptedFogHint e_fog_hint = 4
///   EncryptedMemo e_memo = 5
///
/// Digestible field order (from struct declaration):
///   masked_amount (renamed "amount"), target_key, public_key, e_fog_hint, e_memo
pub(crate) fn digest_tx_out(d: &mut McDigest, tx_out_bytes: &[u8]) {
    let fields = parse_proto_fields(tx_out_bytes);

    d.agg_open(b"", b"TxOut");

    // masked_amount — #[digestible(name = "amount")] #[digestible(transparent)]
    // MaskedAmount is transparent, so it passes through to MaskedAmountV1 or V2.
    // V1 is prost oneof tag 1, V2 is tag 6.
    if let Some(v1_field) = find_field(&fields, 1) {
        // MaskedAmountV1 — #[digestible(name = "Amount")] so type name is "Amount"
        digest_masked_amount(d, b"amount", v1_field.data, b"Amount");
    } else if let Some(v2_field) = find_field(&fields, 6) {
        // MaskedAmountV2 — digest as MaskedAmountV2 struct
        digest_masked_amount(d, b"amount", v2_field.data, b"MaskedAmountV2");
    }
    // If neither present, omit (Option::allow_omit with None)

    // target_key — CompressedRistrettoPublic (transparent → CompressedRistretto → "ristretto")
    if let Some(f) = find_field(&fields, 2) {
        let key_bytes = extract_ristretto_bytes(f.data);
        if !key_bytes.is_empty() {
            d.ristretto(b"target_key", &key_bytes);
        }
    }

    // public_key — CompressedRistrettoPublic (transparent → "ristretto")
    if let Some(f) = find_field(&fields, 3) {
        let key_bytes = extract_ristretto_bytes(f.data);
        if !key_bytes.is_empty() {
            d.ristretto(b"public_key", &key_bytes);
        }
    }

    // e_fog_hint — EncryptedFogHint (transparent → bytes)
    if let Some(f) = find_field(&fields, 4) {
        // EncryptedFogHint wraps: message EncryptedFogHint { bytes data = 1; }
        let hint_fields = parse_proto_fields(f.data);
        if let Some(data_field) = find_field(&hint_fields, 1) {
            if !data_field.data.is_empty() {
                d.bytes_primitive(b"e_fog_hint", data_field.data);
            }
        }
    }

    // e_memo — Option<EncryptedMemo> (NOT transparent — regular struct wrapping bytes)
    // EncryptedMemo is a tuple struct: struct EncryptedMemo(GenericArray<u8, U66>)
    // Digest: agg_open("e_memo", "EncryptedMemo") → bytes_primitive("0", data) → agg_close
    if let Some(f) = find_field(&fields, 5) {
        let memo_fields = parse_proto_fields(f.data);
        if let Some(data_field) = find_field(&memo_fields, 1) {
            if !data_field.data.is_empty() {
                d.agg_open(b"e_memo", b"EncryptedMemo");
                d.bytes_primitive(b"0", data_field.data);
                d.agg_close(b"e_memo", b"EncryptedMemo");
            }
        }
    }

    d.agg_close(b"", b"TxOut");
}

/// Digest a MaskedAmountV1 or V2 struct.
/// Both have the same fields: commitment(1), masked_value(2), masked_token_id(3).
fn digest_masked_amount(d: &mut McDigest, context: &'static [u8], amount_bytes: &[u8], type_name: &'static [u8]) {
    let fields = parse_proto_fields(amount_bytes);

    d.agg_open(context, type_name);

    // commitment — CompressedCommitment (transparent → CompressedRistretto → "ristretto")
    if let Some(f) = find_field(&fields, 1) {
        let commit_bytes = extract_ristretto_bytes(f.data);
        if !commit_bytes.is_empty() {
            d.ristretto(b"commitment", &commit_bytes);
        }
    }

    // masked_value — u64 (fixed64 in proto, always appended)
    if let Some(f) = find_field(&fields, 2) {
        d.uint64_always(b"masked_value", f.fixed64_value);
    } else {
        d.uint64_always(b"masked_value", 0);
    }

    // masked_token_id — Vec<u8> (bytes, allow_omit skips if empty)
    if let Some(f) = find_field(&fields, 3) {
        d.bytes_allow_omit(b"masked_token_id", f.data);
    }

    d.agg_close(context, type_name);
}

/// Digest a TxOutMembershipProof from parsed protobuf bytes.
///
/// TxOutMembershipProof { index(1): u64, highest_index(2): u64, elements(3): repeated Element }
/// TxOutMembershipElement { range(1): Range, hash(2): TxOutMembershipHash }
/// Range { from(1): u64, to(2): u64 }
/// TxOutMembershipHash(pub [u8; 32]) — non-transparent tuple struct
pub(crate) fn digest_membership_proof(d: &mut McDigest, proof_bytes: &[u8]) {
    let fields = parse_proto_fields(proof_bytes);

    d.agg_open(b"", b"TxOutMembershipProof");

    // index — u64 (always appended)
    let index = find_field(&fields, 1).map(|f| f.varint_value).unwrap_or(0);
    d.uint64_always(b"index", index);

    // highest_index — u64 (always appended)
    let highest_index = find_field(&fields, 2).map(|f| f.varint_value).unwrap_or(0);
    d.uint64_always(b"highest_index", highest_index);

    // elements — Vec<TxOutMembershipElement> (allow_omit, skip if empty)
    let elements = find_all_fields(&fields, 3);
    if !elements.is_empty() {
        d.seq_header(b"elements", elements.len());
        for elem in &elements {
            digest_membership_element(d, elem.data);
        }
    }

    d.agg_close(b"", b"TxOutMembershipProof");
}

/// Digest a TxOutMembershipElement.
fn digest_membership_element(d: &mut McDigest, elem_bytes: &[u8]) {
    let fields = parse_proto_fields(elem_bytes);

    d.agg_open(b"", b"TxOutMembershipElement");

    // range — Range { from(1): u64, to(2): u64 }
    if let Some(f) = find_field(&fields, 1) {
        let range_fields = parse_proto_fields(f.data);
        d.agg_open(b"range", b"Range");
        let from = find_field(&range_fields, 1).map(|f| f.varint_value).unwrap_or(0);
        d.uint64_always(b"from", from);
        let to = find_field(&range_fields, 2).map(|f| f.varint_value).unwrap_or(0);
        d.uint64_always(b"to", to);
        d.agg_close(b"range", b"Range");
    }

    // hash — TxOutMembershipHash is #[digestible(transparent)] wrapping [u8; 32]
    // [u8; 32] digests as bytes primitive (via DigestibleAsBytes blanket impl)
    // So: bytes_primitive("hash", data) — no aggregate wrapper
    if let Some(f) = find_field(&fields, 2) {
        let hash_fields = parse_proto_fields(f.data);
        let hash_data = find_field(&hash_fields, 1).map(|f| f.data).unwrap_or(&[]);
        if !hash_data.is_empty() {
            d.bytes_primitive(b"hash", hash_data);
        }
    }

    d.agg_close(b"", b"TxOutMembershipElement");
}

/// Digest a TxOut from our BuiltTxOut struct (for outputs we create).
pub(crate) fn digest_built_tx_out(
    d: &mut McDigest,
    target_key: &[u8],
    public_key: &[u8],
    commitment: &[u8],
    masked_value: u64,
    masked_token_id: &[u8],
    e_fog_hint: &[u8],
    e_memo: &[u8],
) {
    d.agg_open(b"", b"TxOut");

    // masked_amount — MaskedAmountV2 (transparent enum → direct V2 struct)
    d.agg_open(b"amount", b"MaskedAmountV2");
    d.ristretto(b"commitment", commitment);
    d.uint64_always(b"masked_value", masked_value);
    d.bytes_allow_omit(b"masked_token_id", masked_token_id);
    d.agg_close(b"amount", b"MaskedAmountV2");

    // target_key — CompressedRistrettoPublic (transparent → "ristretto")
    d.ristretto(b"target_key", target_key);

    // public_key — CompressedRistrettoPublic (transparent → "ristretto")
    d.ristretto(b"public_key", public_key);

    // e_fog_hint — EncryptedFogHint (transparent → bytes)
    if !e_fog_hint.is_empty() {
        d.bytes_primitive(b"e_fog_hint", e_fog_hint);
    }

    // e_memo — Option<EncryptedMemo> (NOT transparent — regular struct wrapping bytes)
    // EncryptedMemo is a tuple struct, digested as aggregate with inner field context "0"
    if !e_memo.is_empty() {
        d.agg_open(b"e_memo", b"EncryptedMemo");
        d.bytes_primitive(b"0", e_memo);
        d.agg_close(b"e_memo", b"EncryptedMemo");
    }

    d.agg_close(b"", b"TxOut");
}

/// Compute the TxPrefix hash using Merlin transcripts, matching MobileCoin's
/// mc-crypto-digestible protocol.
///
/// TxPrefix Digestible tree:
///   TxPrefix {
///     inputs: Vec<TxIn> {
///       ring: Vec<TxOut>   ← from tx_out_bytes (parsed protobuf)
///       proofs: Vec<Proof> ← from proof_bytes (parsed protobuf)
///     }
///     outputs: Vec<TxOut>  ← from BuiltTxOut fields
///     fee: u64
///     tombstone_block: u64
///     // fee_token_id: #[digestible(omit)] — SKIPPED
///   }
pub(crate) fn compute_tx_prefix_hash_merlin(
    inputs: &[(&[crate::transaction::RingMember], &[u8])],  // (ring, pseudo_output) per input — pseudo_output NOT in hash
    outputs: &[crate::transaction::BuiltTxOut],
    fee: u64,
    tombstone_block: u64,
) -> [u8; 32] {
    let mut d = McDigest::new();

    d.agg_open(b"mobilecoin-tx-prefix", b"TxPrefix");

    // ── inputs: Vec<TxIn> ──
    if !inputs.is_empty() {
        d.seq_header(b"inputs", inputs.len());
        for (ring, _pseudo_output) in inputs {
            d.agg_open(b"", b"TxIn");

            // ring: Vec<TxOut>
            if !ring.is_empty() {
                d.seq_header(b"ring", ring.len());
                for member in *ring {
                    digest_tx_out(&mut d, &member.tx_out_bytes);
                }
            }

            // proofs: Vec<TxOutMembershipProof>
            if !ring.is_empty() {
                // Count non-empty proofs
                let proof_count = ring.iter().filter(|m| !m.proof_bytes.is_empty()).count();
                if proof_count > 0 {
                    d.seq_header(b"proofs", proof_count);
                    for member in *ring {
                        if !member.proof_bytes.is_empty() {
                            digest_membership_proof(&mut d, &member.proof_bytes);
                        }
                    }
                }
            }

            // input_rules: Option<InputRules> — None for basic transfers, allow_omit skips
            d.agg_close(b"", b"TxIn");
        }
    }

    // ── outputs: Vec<TxOut> ──
    if !outputs.is_empty() {
        d.seq_header(b"outputs", outputs.len());
        for output in outputs {
            digest_built_tx_out(
                &mut d,
                &output.target_key,
                &output.public_key,
                &output.commitment,
                output.masked_value,
                &output.masked_token_id,
                &output.e_fog_hint,
                &output.e_memo,
            );
        }
    }

    // ── fee: u64 (always appended) ──
    d.uint64_always(b"fee", fee);

    // ── tombstone_block: u64 (always appended) ──
    d.uint64_always(b"tombstone_block", tombstone_block);

    // fee_token_id: #[digestible(omit)] — SKIPPED

    d.agg_close(b"mobilecoin-tx-prefix", b"TxPrefix");

    d.finalize()
}

// ── MLSAG Signing Digest (multi-layer) ──
//
// MobileCoin's consensus enclave does NOT verify MLSAG signatures against the
// raw TxPrefix hash. Instead, it computes a multi-layer signing digest:
//
//   Layer 0: tx_prefix_hash = TxPrefix.digest32(Merlin, "mobilecoin-tx-prefix")
//
//   Layer 1 (block version >= 2): extended_message_digest
//     = Merlin("mc_extended_message") {
//         message: bytes(tx_prefix_hash)
//         pseudo_output_commitments: seq of ristretto
//         range_proof_bytes: bytes (allow_omit)
//         range_proofs: seq of bytes (allow_omit)
//       }
//
//   Layer 2 (block version >= 3): mlsag_signing_digest
//     = Merlin("mc_extended_message_and_tx_summary") {
//         extended_message: bytes(extended_message_digest)
//         tx_summary: TxSummary (Digestible aggregate)
//       }
//
// Reference: mobilecoin/transaction/core/src/ring_ct/signing_digest.rs

/// Compute the extended message digest (Layer 1).
///
/// This wraps the TxPrefix hash with pseudo-output commitments and range proof
/// in a new Merlin transcript. Matches MobileCoin's `digest_extended_message()`.
///
/// For block v3+: range_proof_bytes is EMPTY, range_proofs has one entry per token id.
/// For block v2:  range_proof_bytes is populated, range_proofs is EMPTY.
/// Both are appended with allow_omit (skipped when empty).
fn compute_extended_message_digest(
    tx_prefix_hash: &[u8; 32],
    pseudo_output_commitments: &[&[u8]],  // each is 32 bytes (CompressedRistretto)
    range_proof_bytes: &[u8],             // single combined proof (block v2, empty for v3+)
    range_proofs: &[&[u8]],              // per-token-id proofs (block v3+, empty for v2)
) -> [u8; 32] {
    let mut d = McDigest::with_label(b"mc_extended_message");

    // message: &[u8] → primitive "bytes"
    d.bytes_primitive(b"message", tx_prefix_hash);

    // pseudo_output_commitments: &[CompressedCommitment] → seq of ristretto
    // CompressedCommitment is #[digestible(transparent)] → CompressedRistretto → ristretto
    d.seq_header(b"pseudo_output_commitments", pseudo_output_commitments.len());
    for po in pseudo_output_commitments {
        d.ristretto(b"", po);
    }

    // range_proof_bytes: &[u8] → bytes (allow_omit: skip if empty)
    // For block v3+, this is empty → skipped.
    if !range_proof_bytes.is_empty() {
        d.bytes_primitive(b"range_proof_bytes", range_proof_bytes);
    }

    // range_proofs: &[Vec<u8>] → seq of bytes (allow_omit: skip if empty)
    // For block v3+, this has one range proof per unique token id.
    if !range_proofs.is_empty() {
        d.seq_header(b"range_proofs", range_proofs.len());
        for proof in range_proofs {
            d.bytes_primitive(b"", proof);
        }
    }

    d.finalize()
}

/// Digest a TxOutSummary into the Merlin transcript.
///
/// TxOutSummary {
///   masked_amount: Option<MaskedAmount>,  // transparent enum → V1/V2
///   target_key: CompressedRistrettoPublic, // transparent → ristretto
///   public_key: CompressedRistrettoPublic, // transparent → ristretto
///   associated_to_input_rules: bool,       // primitive "bool"
/// }
fn digest_tx_out_summary(
    d: &mut McDigest,
    output: &crate::transaction::BuiltTxOut,
) {
    d.agg_open(b"", b"TxOutSummary");

    // masked_amount — same transparent MaskedAmount as TxOut, field name "masked_amount"
    // NOTE: TxOutSummary uses field name "masked_amount" (NOT "amount" like TxOut!)
    d.agg_open(b"masked_amount", b"MaskedAmountV2");
    d.ristretto(b"commitment", &output.commitment);
    d.uint64_always(b"masked_value", output.masked_value);
    d.bytes_allow_omit(b"masked_token_id", &output.masked_token_id);
    d.agg_close(b"masked_amount", b"MaskedAmountV2");

    // target_key — ristretto
    d.ristretto(b"target_key", &output.target_key);

    // public_key — ristretto
    d.ristretto(b"public_key", &output.public_key);

    // associated_to_input_rules — bool (always false for basic transactions)
    d.bool_primitive(b"associated_to_input_rules", false);

    d.agg_close(b"", b"TxOutSummary");
}

/// Digest a TxInSummary into the Merlin transcript.
///
/// TxInSummary {
///   pseudo_output_commitment: CompressedCommitment, // transparent → ristretto
///   input_rules_digest: Vec<u8>,                    // bytes (allow_omit)
/// }
fn digest_tx_in_summary(
    d: &mut McDigest,
    pseudo_output_commitment: &[u8],  // 32 bytes
) {
    d.agg_open(b"", b"TxInSummary");

    // pseudo_output_commitment — CompressedCommitment (transparent → ristretto)
    d.ristretto(b"pseudo_output_commitment", pseudo_output_commitment);

    // input_rules_digest — Vec<u8> (allow_omit, empty for basic tx → skipped)

    d.agg_close(b"", b"TxInSummary");
}

/// Compute the MLSAG signing digest (Layer 2, block version >= 3).
///
/// Combines the extended message digest with a TxSummary in a new Merlin transcript.
/// Matches MobileCoin's `compute_mlsag_signing_digest()` for block version >= 3.
pub(crate) fn compute_mlsag_signing_digest(
    tx_prefix_hash: &[u8; 32],
    pseudo_output_commitments: &[&[u8]],     // each 32 bytes (CompressedRistretto)
    range_proof_bytes: &[u8],                // single combined proof (block v2, empty for v3+)
    range_proofs: &[&[u8]],                 // per-token-id proofs (block v3+, empty for v2)
    outputs: &[crate::transaction::BuiltTxOut],
    fee: u64,
    fee_token_id: u64,
    tombstone_block: u64,
) -> [u8; 32] {
    // Layer 1: Extended message digest
    let extended_message = compute_extended_message_digest(
        tx_prefix_hash,
        pseudo_output_commitments,
        range_proof_bytes,
        range_proofs,
    );

    // Layer 2: Extended message + TxSummary digest
    let mut d = McDigest::with_label(b"mc_extended_message_and_tx_summary");

    // extended_message: Vec<u8> → bytes primitive
    d.bytes_primitive(b"extended_message", &extended_message);

    // tx_summary: TxSummary → Digestible aggregate
    d.agg_open(b"tx_summary", b"TxSummary");

    // outputs: Vec<TxOutSummary>
    if !outputs.is_empty() {
        d.seq_header(b"outputs", outputs.len());
        for output in outputs {
            digest_tx_out_summary(&mut d, output);
        }
    }

    // inputs: Vec<TxInSummary> (one per pseudo_output)
    if !pseudo_output_commitments.is_empty() {
        d.seq_header(b"inputs", pseudo_output_commitments.len());
        for po in pseudo_output_commitments {
            digest_tx_in_summary(&mut d, po);
        }
    }

    // fee: u64 (always)
    d.uint64_always(b"fee", fee);

    // fee_token_id: u64 in TxSummary (plain u64, NOT TokenId wrapper)
    // TxSummary defines this as `pub fee_token_id: u64` — no wrapper type
    d.uint64_always(b"fee_token_id", fee_token_id);

    // tombstone_block: u64 (always)
    d.uint64_always(b"tombstone_block", tombstone_block);

    d.agg_close(b"tx_summary", b"TxSummary");

    d.finalize()
}

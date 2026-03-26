//! MobileCoin transaction construction.
//!
//! Implements the full transaction build pipeline:
//!   1. Stealth address (one-time key) generation for outputs
//!   2. Pedersen amount commitment + MaskedAmountV2 masking
//!   3. MLSAG ring signatures for inputs (sender anonymity)
//!   4. Fog hint encryption (fog-ingest discovery)
//!   5. Transaction assembly + serialization
//!
//! Reference: mobilecoinfoundation/mobilecoin transaction/core/src/

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use blake2::{Blake2b512, Digest};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use hkdf::Hkdf;
use sha2::Sha512;

use crate::keys::scalar_from_canonical;
use crate::proto::{encode_proto_bytes, encode_varint_field, encode_fixed64, encode_submessage, encode_packed_fixed64};

// ── Domain separation tags (must match MobileCoin exactly) ──

/// Hash-to-scalar for one-time key derivation
const ONETIME_KEY_HASH_TO_SCALAR: &[u8] = b"mc_onetime_key_hash_to_scalar";

/// Hash-to-point for key images and token generators
const ONETIME_KEY_HASH_TO_POINT: &[u8] = b"mc_onetime_key_hash_to_point";

/// Amount shared secret derivation
const AMOUNT_SHARED_SECRET_TAG: &[u8] = b"mc_amount_shared_secret";

/// HKDF salt for amount blinding factors
const AMOUNT_BLINDING_SALT: &[u8] = b"mc_amount_blinding_factors";

/// HKDF info tags for value, token_id, and blinding masks
const AMOUNT_VALUE_INFO: &[u8] = b"mc_amount_value";
const AMOUNT_TOKEN_ID_INFO: &[u8] = b"mc_amount_token_id";
const AMOUNT_BLINDING_INFO: &[u8] = b"mc_amount_blinding";

/// MLSAG challenge domain tag
const MLSAG_CHALLENGE_TAG: &[u8] = b"mc_ring_mlsag_challenge";

/// HKDF salt for encrypted memo key derivation
const MEMO_KEY_SALT: &[u8] = b"mc-memo-okm";

/// Encrypted memo payload length (2-byte type + 64 bytes data)
const MEMO_DATA_LEN: usize = 66;

// ── Memo type constants (MobileCoin RTH memo spec) ──
//
// Each memo is 66 bytes: [type_prefix: 2] [payload: 64]
// Encrypted with XOR against HKDF(shared_secret, "mc-memo-okm").
//
// Reference: mc-transaction-extra/src/memo/ in mobilecoinfoundation/mobilecoin

/// 0x0101: AuthenticatedSenderWithPaymentRequestMemo — sender identity + payment request ID
const MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST: [u8; 2] = [0x01, 0x01];

/// 0x0200: DestinationMemo — written on change output, records where payment went
const MEMO_TYPE_DESTINATION: [u8; 2] = [0x02, 0x00];

/// Domain tag for sender credential HMAC key derivation
/// Reference: mc-transaction-extra/src/memo/credential.rs
const SENDER_MEMO_CREDENTIAL_DOMAIN: &[u8] = b"mc-memo-mac";

// ── Token ID 0 = MOB ──
const TOKEN_ID_MOB: u64 = 0;

// ── Types for transaction construction ──

/// A TxOut in the ring (ring member from merkle proofs / ring samples)
#[derive(Serialize, Deserialize, Clone)]
pub struct RingMember {
    pub target_key: Vec<u8>,      // 32-byte compressed Ristretto
    pub public_key: Vec<u8>,      // 32-byte compressed Ristretto
    pub commitment: Vec<u8>,      // 32-byte compressed Ristretto (Pedersen)
    #[serde(default)] pub tx_out_bytes: Vec<u8>,   // full TxOut protobuf (opaque, for Tx encoding)
    #[serde(default)] pub proof_bytes: Vec<u8>,     // TxOutMembershipProof protobuf (opaque)
}

/// An owned TxOut that we want to spend
#[derive(Serialize, Deserialize, Clone)]
pub struct OwnedTxOutInput {
    /// Index of real member in the ring (0..ring_size)
    pub real_index: usize,
    /// Ring members (ring_size = 11)
    pub ring: Vec<RingMember>,
    /// Subaddress index that owns this TxOut (for deriving onetime key + blinding)
    pub subaddress_index: u64,
    /// Value in picoMOB
    pub value: u64,
    /// Token ID (0 = MOB)
    pub token_id: u64,
}

/// Recipient info for building an output
#[derive(Serialize, Deserialize, Clone)]
pub struct Recipient {
    pub view_public_key: Vec<u8>,       // 32-byte compressed Ristretto
    pub spend_public_key: Vec<u8>,      // 32-byte compressed Ristretto
    pub fog_report_url: String,
}

/// A built TxOut ready for inclusion in a transaction
#[derive(Serialize, Deserialize, Clone)]
pub struct BuiltTxOut {
    pub target_key: Vec<u8>,      // 32-byte compressed Ristretto (one-time public key)
    pub public_key: Vec<u8>,      // 32-byte compressed Ristretto (tx public key R)
    pub masked_value: u64,
    pub masked_token_id: Vec<u8>, // 8 bytes LE
    pub commitment: Vec<u8>,      // 32-byte compressed Ristretto (Pedersen)
    pub e_fog_hint: Vec<u8>,      // 128 bytes (encrypted fog hint)
    pub e_memo: Vec<u8>,          // 66 bytes (encrypted memo, required for block version >= 1)
    /// The blinding factor (needed for MLSAG if this is a change output)
    pub blinding: Vec<u8>,        // 32-byte Scalar (NOT included in wire format)
    /// The plaintext value (NOT included in wire format, used for range proof after sort)
    #[serde(default)]
    pub value: u64,
}

/// MLSAG ring signature for a single input
#[derive(Serialize, Deserialize, Clone)]
pub struct RingMLSAG {
    pub c_zero: Vec<u8>,         // 32-byte Scalar
    pub responses: Vec<Vec<u8>>, // 2 * ring_size Scalars, each 32 bytes
    pub key_image: Vec<u8>,      // 32-byte compressed Ristretto
}

/// A signed input
#[derive(Serialize, Deserialize, Clone)]
pub struct SignedInput {
    pub ring: Vec<RingMember>,
    pub pseudo_output: Vec<u8>,   // 32-byte compressed Ristretto
    pub mlsag: RingMLSAG,
}

/// The complete built transaction
#[derive(Serialize, Deserialize)]
pub struct BuiltTransaction {
    pub inputs: Vec<SignedInput>,
    pub outputs: Vec<BuiltTxOut>,
    pub fee: u64,
    pub tombstone_block: u64,
    /// Hash of the TxPrefix (signed by MLSAG)
    pub tx_prefix_hash: Vec<u8>,
    /// Bulletproofs range proof covering all output commitments
    pub range_proof: crate::bulletproofs::RangeProof,
}

/// Result returned to JS from build_transaction
#[derive(Serialize)]
pub struct TxBuildResult {
    /// Protobuf-encoded Tx message (ready for consensus submission)
    pub tx_bytes: Vec<u8>,
    /// Hash of the TxPrefix (32 bytes, used as transaction ID)
    pub tx_prefix_hash: Vec<u8>,
    /// Key images, one per input (each 32 bytes, for spend tracking)
    pub key_images: Vec<Vec<u8>>,
    /// Confirmation number for the recipient output (32 bytes HMAC-SHA256).
    /// The recipient can verify this against the TxOut they received.
    pub confirmation_number: Vec<u8>,
}

// ── Protobuf Tx encoding ──

/// Encode a CompressedRistretto protobuf: message { bytes data = 1; }
fn encode_compressed_ristretto(data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(data.len() + 4);
    encode_proto_bytes(&mut buf, 1, data);
    buf
}

/// Encode a BuiltTxOut as a protobuf TxOut message.
///
/// TxOut {
///   MaskedAmount masked_amount_v2 = 6 {
///     CompressedRistretto commitment = 1 { bytes data = 1 }
///     fixed64 masked_value = 2
///     bytes masked_token_id = 3
///   }
///   CompressedRistretto target_key = 2 { bytes data = 1 }
///   CompressedRistretto public_key = 3 { bytes data = 1 }
///   EncryptedFogHint e_fog_hint = 4 { bytes data = 1 }
/// }
fn encode_tx_out(output: &BuiltTxOut) -> Vec<u8> {
    let mut buf = Vec::with_capacity(256);

    // MaskedAmount (field 6 = masked_amount_v2)
    let mut masked_amount = Vec::new();
    let commitment = encode_compressed_ristretto(&output.commitment);
    encode_submessage(&mut masked_amount, 1, &commitment);
    encode_fixed64(&mut masked_amount, 2, output.masked_value);
    if !output.masked_token_id.is_empty() {
        encode_proto_bytes(&mut masked_amount, 3, &output.masked_token_id);
    }
    encode_submessage(&mut buf, 6, &masked_amount);

    // target_key (field 2)
    let target = encode_compressed_ristretto(&output.target_key);
    encode_submessage(&mut buf, 2, &target);

    // public_key (field 3)
    let pubkey = encode_compressed_ristretto(&output.public_key);
    encode_submessage(&mut buf, 3, &pubkey);

    // e_fog_hint (field 4) = EncryptedFogHint { bytes data = 1 }
    if !output.e_fog_hint.is_empty() {
        let mut hint = Vec::new();
        encode_proto_bytes(&mut hint, 1, &output.e_fog_hint);
        encode_submessage(&mut buf, 4, &hint);
    }

    // e_memo (field 5) = EncryptedMemo { bytes data = 1 }
    if !output.e_memo.is_empty() {
        let mut memo = Vec::new();
        encode_proto_bytes(&mut memo, 1, &output.e_memo);
        encode_submessage(&mut buf, 5, &memo);
    }

    buf
}

/// Encode a RingMLSAG as protobuf.
///
/// RingMLSAG {
///   CurveScalar c_zero = 1 { bytes data = 1 }
///   repeated CurveScalar responses = 2 { bytes data = 1 }
///   KeyImage key_image = 3 { bytes data = 1 }
/// }
fn encode_ring_mlsag(mlsag: &RingMLSAG) -> Vec<u8> {
    let mut buf = Vec::new();

    // c_zero (field 1)
    let c_zero = encode_compressed_ristretto(&mlsag.c_zero);
    encode_submessage(&mut buf, 1, &c_zero);

    // responses (field 2, repeated)
    for response in &mlsag.responses {
        let r = encode_compressed_ristretto(response);
        encode_submessage(&mut buf, 2, &r);
    }

    // key_image (field 3)
    let ki = encode_compressed_ristretto(&mlsag.key_image);
    encode_submessage(&mut buf, 3, &ki);

    buf
}

/// Encode a TxIn as protobuf.
///
/// TxIn {
///   repeated TxOut ring = 1       — use pre-encoded tx_out_bytes
///   repeated TxOutMembershipProof proofs = 2  — use pre-encoded proof_bytes
/// }
fn encode_tx_in(ring: &[RingMember]) -> Vec<u8> {
    let mut buf = Vec::new();

    for member in ring {
        // ring TxOut (field 1) — use raw protobuf bytes from proxy
        encode_submessage(&mut buf, 1, &member.tx_out_bytes);
        // proof (field 2) — use raw protobuf bytes from proxy
        encode_submessage(&mut buf, 2, &member.proof_bytes);
    }

    buf
}

/// Encode the full Tx protobuf from a BuiltTransaction.
///
/// Tx {
///   TxPrefix prefix = 1 {
///     repeated TxIn inputs = 1
///     repeated TxOut outputs = 2
///     uint64 fee = 3
///     uint64 tombstone_block = 4
///   }
///   SignatureRctBulletproofs signature = 2 {
///     repeated RingMLSAG ring_signatures = 1
///     repeated CompressedRistretto pseudo_output_commitments = 2
///     bytes range_proof_bytes = 3      (EMPTY for block v3+)
///     repeated bytes range_proofs = 4  (one per token id, block v3+)
///     repeated fixed64 pseudo_output_token_ids = 5  (block v3+)
///     repeated fixed64 output_token_ids = 6         (block v3+)
///   }
/// }
fn encode_tx(tx: &BuiltTransaction) -> Vec<u8> {
    // ── TxPrefix ──
    let mut prefix = Vec::new();

    // inputs (field 1, repeated TxIn)
    for input in &tx.inputs {
        let tx_in = encode_tx_in(&input.ring);
        encode_submessage(&mut prefix, 1, &tx_in);
    }

    // outputs (field 2, repeated TxOut)
    for output in &tx.outputs {
        let tx_out = encode_tx_out(output);
        encode_submessage(&mut prefix, 2, &tx_out);
    }

    // fee (field 3, uint64)
    encode_varint_field(&mut prefix, 3, tx.fee);

    // tombstone_block (field 4, uint64)
    encode_varint_field(&mut prefix, 4, tx.tombstone_block);

    // ── SignatureRctBulletproofs ──
    let mut signature = Vec::new();

    // ring_signatures (field 1, repeated RingMLSAG)
    for input in &tx.inputs {
        let mlsag = encode_ring_mlsag(&input.mlsag);
        encode_submessage(&mut signature, 1, &mlsag);
    }

    // pseudo_output_commitments (field 2, repeated CompressedRistretto)
    for input in &tx.inputs {
        let po = encode_compressed_ristretto(&input.pseudo_output);
        encode_submessage(&mut signature, 2, &po);
    }

    // range_proof_bytes (field 3, bytes) — EMPTY for block v3+
    // (Do NOT encode field 3 — it must be absent for block version >= 3)

    // range_proofs (field 4, repeated bytes) — one range proof per token id (block v3+)
    // For a single-token MOB transaction, there is exactly one range proof.
    let range_proof_bytes = tx.range_proof.to_bytes();
    encode_proto_bytes(&mut signature, 4, &range_proof_bytes);

    // pseudo_output_token_ids (field 5, packed repeated fixed64) — one per input, all 0 for MOB
    let pseudo_token_ids: Vec<u64> = tx.inputs.iter().map(|_| TOKEN_ID_MOB).collect();
    encode_packed_fixed64(&mut signature, 5, &pseudo_token_ids);

    // output_token_ids (field 6, packed repeated fixed64) — one per output, all 0 for MOB
    let output_token_ids: Vec<u64> = tx.outputs.iter().map(|_| TOKEN_ID_MOB).collect();
    encode_packed_fixed64(&mut signature, 6, &output_token_ids);

    // ── Tx ──
    let mut tx_buf = Vec::new();
    encode_submessage(&mut tx_buf, 1, &prefix);    // prefix (field 1)
    encode_submessage(&mut tx_buf, 2, &signature);  // signature (field 2)

    tx_buf
}

/// Round-trip verification: parse the encoded Tx protobuf back and re-compute
/// the TxPrefix hash from the parsed protobuf (same path MC consensus takes).
/// Any mismatch means our digest_built_tx_out differs from protobuf round-trip.
#[cfg(debug_assertions)]
fn verify_tx_prefix_hash_round_trip(
    tx_bytes: &[u8],
    expected_prefix_hash: &[u8; 32],
    fee: u64,
    tombstone_block: u64,
    expected_signing_digest: &[u8; 32],
    pseudo_output_refs: &[&[u8]],
    range_proof_bytes: &[u8],
    range_proofs: &[&[u8]],
    outputs: &[BuiltTxOut],
    fee_token_id: u64,
) -> Result<(), JsError> {
    use crate::digestible::{parse_proto_fields, find_field, find_all_fields,
        digest_tx_out, McDigest, digest_membership_proof};

    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{:02x}", b)).collect() };

    // Parse Tx: field 1 = TxPrefix, field 2 = signature
    let tx_fields = parse_proto_fields(tx_bytes);
    let prefix_bytes = find_field(&tx_fields, 1)
        .ok_or_else(|| JsError::new("Round-trip: missing TxPrefix"))?.data;
    let sig_bytes = find_field(&tx_fields, 2)
        .ok_or_else(|| JsError::new("Round-trip: missing signature"))?.data;

    // Parse TxPrefix: inputs(1), outputs(2), fee(3), tombstone(4)
    let prefix_fields = parse_proto_fields(prefix_bytes);
    let input_msgs = find_all_fields(&prefix_fields, 1);
    let output_msgs = find_all_fields(&prefix_fields, 2);
    let parsed_fee = find_field(&prefix_fields, 3).map(|f| f.varint_value).unwrap_or(0);
    let parsed_tombstone = find_field(&prefix_fields, 4).map(|f| f.varint_value).unwrap_or(0);

    web_sys::console::log_1(&format!(
        "[WASM round-trip] inputs={}, outputs={}, fee={}, tombstone={}",
        input_msgs.len(), output_msgs.len(), parsed_fee, parsed_tombstone
    ).into());

    // Re-compute TxPrefix hash from protobuf (same as MC consensus does)
    let mut d = McDigest::new();
    d.agg_open(b"mobilecoin-tx-prefix", b"TxPrefix");

    // inputs
    if !input_msgs.is_empty() {
        d.seq_header(b"inputs", input_msgs.len());
        for input_field in &input_msgs {
            let tx_in_fields = parse_proto_fields(input_field.data);
            let ring_outs = find_all_fields(&tx_in_fields, 1);
            let proofs = find_all_fields(&tx_in_fields, 2);

            d.agg_open(b"", b"TxIn");

            // ring
            if !ring_outs.is_empty() {
                d.seq_header(b"ring", ring_outs.len());
                for tx_out_field in &ring_outs {
                    digest_tx_out(&mut d, tx_out_field.data);
                }
            }

            // proofs
            if !proofs.is_empty() {
                d.seq_header(b"proofs", proofs.len());
                for proof_field in &proofs {
                    digest_membership_proof(&mut d, proof_field.data);
                }
            }

            d.agg_close(b"", b"TxIn");
        }
    }

    // outputs — THIS is the key comparison: use digest_tx_out on protobuf bytes
    if !output_msgs.is_empty() {
        d.seq_header(b"outputs", output_msgs.len());
        for output_field in &output_msgs {
            digest_tx_out(&mut d, output_field.data);
        }
    }

    // fee
    d.uint64_always(b"fee", parsed_fee);

    // tombstone_block
    d.uint64_always(b"tombstone_block", parsed_tombstone);

    d.agg_close(b"mobilecoin-tx-prefix", b"TxPrefix");

    let round_trip_hash = d.finalize();

    if round_trip_hash != *expected_prefix_hash {
        web_sys::console::log_1(&format!(
            "[WASM round-trip] PREFIX HASH MISMATCH!\n  expected: {}\n  got:      {}",
            hex(expected_prefix_hash), hex(&round_trip_hash)
        ).into());

        // Narrow down: re-hash just the outputs via both paths
        let mut d_built = McDigest::new();
        d_built.seq_header(b"outputs", outputs.len());
        for output in outputs {
            crate::digestible::digest_built_tx_out(
                &mut d_built,
                &output.target_key, &output.public_key,
                &output.commitment, output.masked_value,
                &output.masked_token_id, &output.e_fog_hint, &output.e_memo,
            );
        }
        let built_hash = d_built.finalize();

        let mut d_proto = McDigest::new();
        d_proto.seq_header(b"outputs", output_msgs.len());
        for output_field in &output_msgs {
            digest_tx_out(&mut d_proto, output_field.data);
        }
        let proto_hash = d_proto.finalize();

        web_sys::console::log_1(&format!(
            "[WASM round-trip] Output digest comparison:\n  built_tx_out path: {}\n  protobuf path:     {}",
            hex(&built_hash), hex(&proto_hash)
        ).into());

        return Err(JsError::new(&format!(
            "TxPrefix hash mismatch: built={} protobuf_roundtrip={}",
            hex(expected_prefix_hash), hex(&round_trip_hash)
        )));
    }

    web_sys::console::log_1(&format!(
        "[WASM round-trip] TxPrefix hash MATCHES: {}", hex(&round_trip_hash)
    ).into());

    // Now re-compute the full signing digest from round-trip data
    let rt_extended = crate::digestible::compute_mlsag_signing_digest(
        &round_trip_hash,
        pseudo_output_refs,
        range_proof_bytes,
        range_proofs,
        outputs,
        fee,
        fee_token_id,
        tombstone_block,
    );

    if rt_extended != *expected_signing_digest {
        web_sys::console::log_1(&format!(
            "[WASM round-trip] SIGNING DIGEST MISMATCH!\n  expected: {}\n  got:      {}",
            hex(expected_signing_digest), hex(&rt_extended)
        ).into());
        return Err(JsError::new(&format!(
            "Signing digest mismatch: expected={} roundtrip={}",
            hex(expected_signing_digest), hex(&rt_extended)
        )));
    }

    web_sys::console::log_1(&format!(
        "[WASM round-trip] Signing digest MATCHES: {}", hex(&rt_extended)
    ).into());

    // Parse signature to extract pseudo_output_commitments and range_proofs
    // and verify they match what we used for the digest
    let sig_fields = parse_proto_fields(sig_bytes);
    let sig_pseudo_outputs = find_all_fields(&sig_fields, 2);
    let sig_range_proof_bytes = find_field(&sig_fields, 3); // field 3 = range_proof_bytes (should be empty for v3+)
    let sig_range_proofs = find_all_fields(&sig_fields, 4); // field 4 = range_proofs (block v3+)

    web_sys::console::log_1(&format!(
        "[WASM round-trip] Signature: {} ring_sigs, {} pseudo_outputs, range_proof_bytes={} bytes, range_proofs={} entries",
        find_all_fields(&sig_fields, 1).len(),
        sig_pseudo_outputs.len(),
        sig_range_proof_bytes.map(|f| f.data.len()).unwrap_or(0),
        sig_range_proofs.len(),
    ).into());

    // Verify pseudo_output_commitments match
    for (i, po_field) in sig_pseudo_outputs.iter().enumerate() {
        let po_inner = parse_proto_fields(po_field.data);
        let po_bytes = find_field(&po_inner, 1).map(|f| f.data).unwrap_or(&[]);
        if i < pseudo_output_refs.len() && po_bytes != pseudo_output_refs[i] {
            web_sys::console::log_1(&format!(
                "[WASM round-trip] pseudo_output[{}] MISMATCH: digest={} protobuf={}",
                i, hex(pseudo_output_refs[i]), hex(po_bytes)
            ).into());
        }
    }

    // Verify range_proofs match (block v3+: field 4)
    for (i, rp_field) in sig_range_proofs.iter().enumerate() {
        if i < range_proofs.len() && rp_field.data != range_proofs[i] {
            web_sys::console::log_1(&format!(
                "[WASM round-trip] range_proofs[{}] MISMATCH: digest_len={} protobuf_len={}",
                i, range_proofs[i].len(), rp_field.data.len()
            ).into());
        }
    }

    Ok(())
}

// ── Helper functions ──

/// Hash-to-scalar: Blake2b512(tag || data) -> Scalar
fn hash_to_scalar(tag: &[u8], data: &[u8]) -> Scalar {
    let mut hasher = Blake2b512::new();
    hasher.update(tag);
    hasher.update(data);
    Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
}

/// Hash-to-point: Blake2b512(tag || data) -> RistrettoPoint
fn hash_to_point(tag: &[u8], data: &[u8]) -> RistrettoPoint {
    let mut hasher = Blake2b512::new();
    hasher.update(tag);
    hasher.update(data);
    let hash_output: [u8; 64] = hasher.finalize().into();
    RistrettoPoint::from_uniform_bytes(&hash_output)
}

/// Decompress a 32-byte compressed Ristretto point
fn decompress(bytes: &[u8]) -> Result<RistrettoPoint, JsError> {
    let compressed = CompressedRistretto::from_slice(bytes)
        .map_err(|_| JsError::new("Invalid compressed point length"))?;
    compressed.decompress()
        .ok_or_else(|| JsError::new("Invalid Ristretto point"))
}

/// Compute the Pedersen generator for a given token ID.
/// Matches mc-crypto-ring-signature/src/ring_signature/mod.rs `generators()`:
///   H = Blake2b512("mc_onetime_key_hash_to_point" || (basepoint_compressed XOR token_id_le))
///   B = RistrettoPoint::from_uniform_bytes(H)
/// The XOR ensures constant-time behavior and backwards-compat (id 0 = no-op XOR).
fn token_generator(token_id: u64) -> RistrettoPoint {
    let id_bytes = token_id.to_le_bytes();
    let mut buf: [u8; 32] = RISTRETTO_BASEPOINT_POINT.compress().to_bytes();
    for i in 0..8 {
        buf[i] ^= id_bytes[i];
    }
    let mut hasher = Blake2b512::new();
    hasher.update(b"mc_onetime_key_hash_to_point");
    hasher.update(buf);
    let hash: [u8; 64] = hasher.finalize().into();
    RistrettoPoint::from_uniform_bytes(&hash)
}

/// Generate a random Scalar
fn random_scalar() -> Scalar {
    let mut bytes = [0u8; 64];
    getrandom::getrandom(&mut bytes).expect("RNG failed");
    Scalar::from_bytes_mod_order_wide(&bytes)
}

/// Compute the TxPrefix hash (message signed by MLSAG)
/// This is a Blake2b512 hash of all TxPrefix fields
/// Compute TxPrefix hash using Merlin transcripts matching MobileCoin's
/// mc-crypto-digestible protocol. See digestible.rs for implementation details.
fn compute_tx_prefix_hash(
    inputs: &[(&[RingMember], &[u8])],  // (ring, pseudo_output) per input
    outputs: &[BuiltTxOut],
    fee: u64,
    tombstone_block: u64,
    _token_id: u64,
) -> [u8; 32] {
    crate::digestible::compute_tx_prefix_hash_merlin(inputs, outputs, fee, tombstone_block)
}

// ── Output construction ──

/// Build a TxOut for a recipient.
///
/// Stealth address derivation (one-time key):
///   1. Generate random tx_private_key r
///   2. R = r * G  (tx public key, sent with the TxOut)
///   3. shared_secret = r * C_i  (ECDH with recipient view public key)
///   4. hs = H_s("mc_onetime_key_hash_to_scalar" || compress(shared_secret))
///   5. target_key = hs * G + D_i  (one-time public key)
///
/// Amount masking (MaskedAmountV2):
///   1. amount_shared_secret = Blake2b512("mc_amount_shared_secret" || compress(shared_secret))[0..32]
///   2. HKDF-SHA512(salt="mc_amount_blinding_factors", ikm=amount_shared_secret)
///   3. value_mask, token_id_mask, blinding from HKDF-Expand
///   4. commitment = value * H_token + blinding * G
/// Build the 66-byte AuthenticatedSenderWithPaymentRequestMemo (type 0x0101).
///
/// Layout: [0x01, 0x01] [sender_address_hash: 16] [payment_request_id: 8 LE]
///         [padding: 32] [hmac: 8]
///
/// The HMAC proves sender identity to the recipient:
///   hmac_key = HMAC-SHA512(key = ECDH(sender_spend_priv, recipient_view_pub),
///                          data = "mc-memo-mac")
///   hmac = HMAC-SHA512(key = hmac_key, data = recipient_spend_pub)[..8]
///
/// Reference: mc-transaction-extra/src/memo/authenticated_sender_with_payment_request_id.rs
fn build_authenticated_sender_memo(
    sender_spend_private: &Scalar,
    sender_address_hash: &[u8; 16],
    recipient: &Recipient,
    payment_request_id: u64,
) -> Result<[u8; MEMO_DATA_LEN], JsError> {
    use hmac::{Hmac, Mac};

    let recipient_view_pub = decompress(&recipient.view_public_key)?;
    let recipient_spend_pub_bytes = &recipient.spend_public_key;

    // ECDH: sender_spend_private * recipient_view_public
    let shared_secret = (*sender_spend_private * recipient_view_pub).compress();

    // Derive HMAC key: HMAC-SHA512(key=shared_secret, data="mc-memo-mac")
    let mut hmac_key_mac = <Hmac<Sha512>>::new_from_slice(shared_secret.as_bytes())
        .map_err(|_| JsError::new("HMAC key derivation failed"))?;
    hmac_key_mac.update(SENDER_MEMO_CREDENTIAL_DOMAIN);
    let hmac_key = hmac_key_mac.finalize().into_bytes();

    // Compute HMAC over recipient's spend public key
    let mut hmac = <Hmac<Sha512>>::new_from_slice(&hmac_key)
        .map_err(|_| JsError::new("HMAC computation failed"))?;
    hmac.update(recipient_spend_pub_bytes);
    let hmac_result = hmac.finalize().into_bytes();
    let hmac_bytes: [u8; 8] = hmac_result[..8].try_into().unwrap();

    let mut memo = [0u8; MEMO_DATA_LEN];
    // Type prefix
    memo[0..2].copy_from_slice(&MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST);
    // Sender address hash (16 bytes)
    memo[2..18].copy_from_slice(sender_address_hash);
    // Payment request ID (u64 LE)
    memo[18..26].copy_from_slice(&payment_request_id.to_le_bytes());
    // Bytes 26..58 = padding (zeros)
    // HMAC (8 bytes, truncated)
    memo[58..66].copy_from_slice(&hmac_bytes);

    Ok(memo)
}

/// Build the 66-byte DestinationMemo (type 0x0200) for the change output.
///
/// Layout: [0x02, 0x00] [recipient_address_hash: 16] [num_recipients: 1]
///         [fee: 8 LE] [total_outlay: 8 LE] [padding: 31]
///
/// Only the sender can decrypt this (it's on their change output).
/// It records where the payment went, enabling receipt reconstruction.
fn build_destination_memo(
    recipient_address_hash: &[u8; 16],
    fee: u64,
    total_outlay: u64,
) -> [u8; MEMO_DATA_LEN] {
    let mut memo = [0u8; MEMO_DATA_LEN];
    memo[0..2].copy_from_slice(&MEMO_TYPE_DESTINATION);
    memo[2..18].copy_from_slice(recipient_address_hash);
    memo[18] = 1; // num_recipients
    memo[19..27].copy_from_slice(&fee.to_le_bytes());
    memo[27..35].copy_from_slice(&total_outlay.to_le_bytes());
    // Bytes 35..66 = padding (zeros)
    memo
}

/// Compute a 16-byte address hash (short address hash for memos).
///
/// Blake2b-512("mc-address-hash" || view_pub || spend_pub)[..16]
///
/// TODO: MC canonical ShortAddressHash uses Blake2b-256, not Blake2b-512.
/// The first 16 bytes differ between the two. Fix when adding cross-wallet
/// memo interop (see TODOS.md "Signal Memo Interop Testing").
///
/// Reference: mc-account-keys/src/account_keys.rs ShortAddressHash
fn compute_address_hash(view_public_key: &[u8], spend_public_key: &[u8]) -> [u8; 16] {
    let mut hasher = Blake2b512::new();
    hasher.update(b"mc-address-hash");
    hasher.update(view_public_key);
    hasher.update(spend_public_key);
    let hash = hasher.finalize();
    let mut result = [0u8; 16];
    result.copy_from_slice(&hash[..16]);
    result
}

/// Encrypt a 66-byte plaintext memo using XOR with HKDF-derived key.
fn encrypt_memo(memo_plaintext: &[u8; MEMO_DATA_LEN], shared_secret: &CompressedRistretto) -> Result<Vec<u8>, JsError> {
    let memo_hk = Hkdf::<Sha512>::new(Some(MEMO_KEY_SALT), shared_secret.as_bytes());
    let mut memo_key = vec![0u8; MEMO_DATA_LEN];
    memo_hk.expand(b"", &mut memo_key)
        .map_err(|_| JsError::new("HKDF expand failed for memo key"))?;

    // XOR encrypt
    let mut e_memo = vec![0u8; MEMO_DATA_LEN];
    for i in 0..MEMO_DATA_LEN {
        e_memo[i] = memo_plaintext[i] ^ memo_key[i];
    }
    Ok(e_memo)
}

/// Compute a confirmation number for a sent TxOut.
///
/// confirmation_number = HMAC-SHA256(key=shared_secret, data=tx_out_public_key)
///
/// The sender can provide this to the recipient as proof of payment.
/// The recipient can verify it using the shared_secret they derive from the TxOut.
fn compute_confirmation_number(shared_secret: &CompressedRistretto, tx_out_public_key: &[u8]) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let mut mac = <Hmac<Sha256>>::new_from_slice(shared_secret.as_bytes())
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(tx_out_public_key);
    mac.finalize().into_bytes().to_vec()
}

/// Build a TxOut.
///
/// MobileCoin subaddress protocol:
///   R = r * D_i                              (tx_public_key = tx_private * recipient_spend_pub)
///   shared_secret = r * C_i = r * a * D_i    (sender side)
///   scanner: a * R = a * r * D_i             (recipient side — equals sender's shared_secret)
///
/// `fog_hint_view_pub`: If provided, use this view public key in the fog hint
/// instead of `recipient.view_public_key`. Required for change outputs where
/// the fog hint must contain the default subaddress view key C_0 = a*D_0
/// (the key fog ingest uses for KexRng routing), not the change subaddress
/// view key C_change.
///
/// `memo_plaintext`: If provided, encrypt this 66-byte memo payload instead of
/// the default zeros. Used for AuthenticatedSenderMemo (recipient output) and
/// DestinationMemo (change output).
fn build_tx_out_inner(
    recipient: &Recipient,
    value: u64,
    token_id: u64,
    fog_ingest_pubkey: Option<&[u8]>,
    fog_hint_view_pub: Option<&[u8]>,
    memo_plaintext: Option<&[u8; MEMO_DATA_LEN]>,
) -> Result<(BuiltTxOut, CompressedRistretto), JsError> {
    let recipient_spend_pub = decompress(&recipient.spend_public_key)?;
    let recipient_view_pub = decompress(&recipient.view_public_key)?;

    // Step 1: Generate random tx_private_key
    let tx_private_key = random_scalar();

    // Step 2: R = r * D_i (recipient's spend public key)
    // This is the MobileCoin subaddress protocol — NOT r*G.
    let tx_public_key = (tx_private_key * recipient_spend_pub).compress();

    // Step 3: shared_secret = r * C_i (recipient's subaddress view public key)
    // Scanner recovers: a * R = a * r * D_i = r * (a * D_i) = r * C_i  ✓
    let shared_secret = (tx_private_key * recipient_view_pub).compress();

    // Step 4: hs = H_s(shared_secret)
    let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());

    // Step 5: target_key = hs * G + D_i (spend public key)
    let target_key = (hs * RISTRETTO_BASEPOINT_POINT + recipient_spend_pub).compress();

    // ── Amount masking ──

    // Amount shared secret
    let mut amount_hasher = Blake2b512::new();
    amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
    amount_hasher.update(shared_secret.as_bytes());
    let amount_hash = amount_hasher.finalize();
    let amount_shared_secret = &amount_hash[..32];

    // HKDF for masks
    let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);

    // Value mask
    let mut value_mask_bytes = [0u8; 8];
    hk.expand(AMOUNT_VALUE_INFO, &mut value_mask_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for value mask"))?;
    let masked_value = value ^ u64::from_le_bytes(value_mask_bytes);

    // Token ID mask
    let mut token_id_mask_bytes = [0u8; 8];
    hk.expand(AMOUNT_TOKEN_ID_INFO, &mut token_id_mask_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for token_id mask"))?;
    let masked_token_id_val = token_id ^ u64::from_le_bytes(token_id_mask_bytes);

    // Blinding factor
    let mut blinding_bytes = [0u8; 64];
    hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for blinding"))?;
    let blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

    // Pedersen commitment: value * H_token + blinding * G
    let h_token = token_generator(token_id);
    let commitment = (Scalar::from(value) * h_token + blinding * RISTRETTO_BASEPOINT_POINT).compress();

    // ── Fog hint ──
    // Fog hint contains the view public key that fog ingest uses for KexRng routing.
    // For recipient outputs: use the recipient's view public key (from their address).
    // For change outputs: use the default subaddress view key C_0 (via fog_hint_view_pub).
    let hint_view_pub = fog_hint_view_pub.unwrap_or(&recipient.view_public_key);
    let e_fog_hint = build_fog_hint(
        hint_view_pub,
        fog_ingest_pubkey,
    )?;

    // ── Encrypted memo (required for block version >= 1) ──
    let e_memo = match memo_plaintext {
        Some(plaintext) => encrypt_memo(plaintext, &shared_secret)?,
        None => {
            // Default memo = 66 zero bytes, encrypted via XOR with HKDF-derived key.
            // Since XOR with zeros = identity, e_memo = memo_key directly.
            let memo_hk = Hkdf::<Sha512>::new(Some(MEMO_KEY_SALT), shared_secret.as_bytes());
            let mut key = vec![0u8; MEMO_DATA_LEN];
            memo_hk.expand(b"", &mut key)
                .map_err(|_| JsError::new("HKDF expand failed for memo key"))?;
            key
        }
    };

    Ok((BuiltTxOut {
        target_key: target_key.as_bytes().to_vec(),
        public_key: tx_public_key.as_bytes().to_vec(),
        masked_value,
        masked_token_id: masked_token_id_val.to_le_bytes().to_vec(),
        commitment: commitment.as_bytes().to_vec(),
        e_fog_hint,
        e_memo,
        blinding: blinding.as_bytes().to_vec(),
        value,
    }, shared_secret))
}

/// Size of the encrypted fog hint.
/// VersionedCryptoBox output is 84 bytes (34 ciphertext + 32 ephemeral pubkey + 16 tag + 2 version),
/// but MobileCoin's EncryptedFogHint is a fixed 128-byte struct. The trailing 44 bytes are zero-padded.
const ENCRYPTED_FOG_HINT_LEN: usize = 128;

/// Build an encrypted fog hint using VersionedCryptoBox format (128 bytes, zero-padded).
///
/// The fog hint tells the fog ingest enclave that this TxOut should be
/// findable by the recipient.
///
/// Plaintext (34 bytes): [view_pubkey(32)] [MAGIC=42] [MAGIC=42]
///   MAGIC_NUMBER = 42, from mc-transaction-core/src/fog_hint.rs
/// Encrypt a fog hint using MobileCoin's VersionedCryptoBox format.
///
/// Must match the format in mc-crypto-box (VersionedCryptoBox v1):
///   - ECDH: ephemeral_private * ingest_pubkey
///   - KDF:  HKDF-Blake2b512(salt="dei-salty-box", ikm=shared_secret, info="aead-key-iv") → 44 bytes
///   - AEAD: AES-256-GCM(key=first 32, nonce=next 12, aad=empty)
///   - Layout: [ciphertext(34)] [ephemeral_pubkey(32)] [tag(16)] [major=1(1)] [minor=0(1)] [zero-pad(44)] = 128 bytes
///
/// This is the encryption counterpart to decrypt_fog_ciphertext_inner in scanning.rs.
fn build_fog_hint(
    recipient_view_pub: &[u8],
    fog_ingest_pubkey: Option<&[u8]>,
) -> Result<Vec<u8>, JsError> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::AeadInPlace};
    use hkdf::SimpleHkdf;

    let mut hint = vec![0u8; ENCRYPTED_FOG_HINT_LEN];

    match fog_ingest_pubkey {
        Some(ingest_key_bytes) => {
            // ECDH with fog ingest enclave key
            let ingest_key = decompress(ingest_key_bytes)?;
            let ephemeral_private = random_scalar();
            let ephemeral_public = (ephemeral_private * RISTRETTO_BASEPOINT_POINT).compress();

            // shared_secret = ephemeral_private * ingest_pubkey
            let shared = (ephemeral_private * ingest_key).compress();

            // HKDF-Blake2b512: derive AES key (32 bytes) + nonce (12 bytes)
            // Must match mc-crypto-box VersionedCryptoBox parameters exactly.
            let hkdf = SimpleHkdf::<Blake2b512>::new(Some(b"dei-salty-box"), shared.as_bytes());
            let mut okm = [0u8; 44];
            hkdf.expand(b"aead-key-iv", &mut okm)
                .map_err(|_| JsError::new("HKDF failed for fog hint key"))?;
            let aes_key = &okm[..32];
            let aes_nonce = &okm[32..44];

            // Build plaintext: recipient's view public key (32 bytes) + 2-byte magic
            // Upstream fog_hint.rs uses MAGIC_NUMBER = 42 for ALL padding bytes
            let mut buffer = vec![0u8; 34];
            buffer[..32].copy_from_slice(recipient_view_pub);
            buffer[32] = 42; // MAGIC_NUMBER from mc-transaction-core/src/fog_hint.rs
            buffer[33] = 42;

            // AES-256-GCM encrypt in place (detached tag)
            let cipher = Aes256Gcm::new_from_slice(aes_key)
                .map_err(|_| JsError::new("AES key init failed"))?;
            let nonce = aes_gcm::Nonce::from_slice(aes_nonce);
            let tag = cipher.encrypt_in_place_detached(nonce, &[], &mut buffer)
                .map_err(|_| JsError::new("AES-GCM encrypt failed"))?;

            // Pack in VersionedCryptoBox format (first 84 bytes, rest stays zero):
            //   [ciphertext(34)] [ephemeral_pubkey(32)] [tag(16)] [major(1)] [minor(1)] [zero(44)] = 128
            hint[0..34].copy_from_slice(&buffer);
            hint[34..66].copy_from_slice(ephemeral_public.as_bytes());
            hint[66..82].copy_from_slice(tag.as_slice());
            hint[82] = 1; // major version
            hint[83] = 0; // minor version
        }
        None => {
            // No fog ingest key — fill with random bytes (indistinguishable fake hint)
            getrandom::getrandom(&mut hint)
                .map_err(|e| JsError::new(&format!("RNG failed: {}", e)))?;
        }
    }

    Ok(hint)
}

// ── MLSAG Ring Signature ──

/// Sign a single input ring with MLSAG.
///
/// The MLSAG proves:
///   1. Knowledge of onetime_private_key x such that P_pi = x * G
///   2. Knowledge of commitment difference key z = blinding - pseudo_blinding
///      such that C_pi - pseudo_output = z * G
///   3. Links via key_image = x * Hp(P_pi)
///
/// Algorithm:
///   For ring of size n, real index pi, two "columns" (onetime key, commitment):
///
///   1. Compute key_image I = x * Hp(P_pi)
///   2. Generate random alpha_0, alpha_1
///   3. At pi:
///      L_0 = alpha_0 * G
///      R_0 = alpha_0 * Hp(P_pi)
///      L_1 = alpha_1 * G
///   4. c_{pi+1} = H(msg || I || pi || L_0 || R_0 || L_1)
///   5. For i = pi+1, ..., pi-1 (mod n):
///      Generate random r_{i,0}, r_{i,1}
///      L_0 = r_{i,0} * G + c_i * P_i
///      R_0 = r_{i,0} * Hp(P_i) + c_i * I
///      L_1 = r_{i,1} * G + c_i * Q_i  where Q_i = C_i - pseudo_output
///      c_{i+1} = H(msg || I || i || L_0 || R_0 || L_1)
///   6. Close ring:
///      r_{pi,0} = alpha_0 - c_pi * x
///      r_{pi,1} = alpha_1 - c_pi * z
fn sign_mlsag(
    message: &[u8; 32],
    ring: &[RingMember],
    real_index: usize,
    onetime_private_key: &Scalar,
    value: u64,
    blinding: &Scalar,
    pseudo_output_blinding: &Scalar,
    token_id: u64,
) -> Result<(RingMLSAG, CompressedRistretto), JsError> {
    let ring_size = ring.len();
    if real_index >= ring_size {
        return Err(JsError::new("real_index out of range"));
    }

    let x = *onetime_private_key;
    // MC convention: z = output_blinding - input_blinding = pseudo_blinding - real_blinding
    let z = *pseudo_output_blinding - *blinding;

    // Compute pseudo-output commitment
    let h_token = token_generator(token_id);
    let pseudo_output = (Scalar::from(value) * h_token + *pseudo_output_blinding * RISTRETTO_BASEPOINT_POINT).compress();

    // Compute key image: I = x * Hp(P_pi)
    let p_pi = CompressedRistretto::from_slice(&ring[real_index].target_key)
        .map_err(|_| JsError::new("Invalid target key in ring"))?;

    // ── Self-verification: onetime private key must match target_key ──
    let computed_pubkey = (x * RISTRETTO_BASEPOINT_POINT).compress();
    if computed_pubkey != p_pi {
        let expected_hex: String = p_pi.as_bytes().iter().map(|b| format!("{:02x}", b)).collect();
        let got_hex: String = computed_pubkey.as_bytes().iter().map(|b| format!("{:02x}", b)).collect();
        let x_hex: String = x.as_bytes().iter().map(|b| format!("{:02x}", b)).collect();
        let ring_pk_hex: String = ring[real_index].public_key.iter().map(|b| format!("{:02x}", b)).collect();
        return Err(JsError::new(&format!(
            "MLSAG self-check FAILED: x*G != target_key. target={} xG={} x={} ring_pk={} real_idx={}",
            expected_hex, got_hex, x_hex, ring_pk_hex, real_index
        )));
    }

    // ── Self-verification: commitment balance ──
    // z = pseudo_blinding - blinding (MC convention)
    // Z_real = pseudo_output - C_real = z * G
    let real_commitment = decompress(&ring[real_index].commitment)?;
    let expected_z_point = pseudo_output.decompress()
        .ok_or_else(|| JsError::new("Invalid pseudo output for self-check"))? - real_commitment;
    let computed_z_point = z * RISTRETTO_BASEPOINT_POINT;
    if computed_z_point.compress() != expected_z_point.compress() {
        let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{:02x}", b)).collect() };
        let expected_c = Scalar::from(value) * h_token + *blinding * RISTRETTO_BASEPOINT_POINT;
        return Err(JsError::new(&format!(
            "MLSAG self-check FAILED: commitment balance z*G != pseudo - C_real. \
             C_real={} expected_C(v*H+b*G)={} pseudo={} value={} blinding={} pseudo_blind={} z={} commitment_len={}",
            hex(real_commitment.compress().as_bytes()),
            hex(expected_c.compress().as_bytes()),
            hex(pseudo_output.as_bytes()),
            value,
            hex(blinding.as_bytes()),
            hex(pseudo_output_blinding.as_bytes()),
            hex(z.as_bytes()),
            ring[real_index].commitment.len(),
        )));
    }

    let hp_pi = hash_to_point(ONETIME_KEY_HASH_TO_POINT, p_pi.as_bytes());
    let key_image = (x * hp_pi).compress();

    // Decompress all ring members upfront
    let mut ring_target_keys: Vec<RistrettoPoint> = Vec::with_capacity(ring_size);
    let mut ring_commitments: Vec<RistrettoPoint> = Vec::with_capacity(ring_size);
    let pseudo_output_point = pseudo_output.decompress()
        .ok_or_else(|| JsError::new("Invalid pseudo output"))?;

    for member in ring {
        ring_target_keys.push(decompress(&member.target_key)?);
        ring_commitments.push(decompress(&member.commitment)?);
    }

    let key_image_point = key_image.decompress()
        .ok_or_else(|| JsError::new("Invalid key image point"))?;

    // Generate random alphas
    let alpha_0 = random_scalar();
    let alpha_1 = random_scalar();

    // Compute initial L and R at real index
    let l_0 = (alpha_0 * RISTRETTO_BASEPOINT_POINT).compress();
    let r_0 = (alpha_0 * hp_pi).compress();
    let l_1 = (alpha_1 * RISTRETTO_BASEPOINT_POINT).compress();

    // c_{pi+1} = challenge hash (MC does NOT include ring_index in the hash)
    let c_next = mlsag_challenge(message, &key_image, &l_0, &r_0, &l_1);

    // Generate responses for all non-real indices
    let mut responses = vec![Scalar::ZERO; 2 * ring_size];
    let mut challenges = vec![Scalar::ZERO; ring_size];
    challenges[(real_index + 1) % ring_size] = c_next;

    // Walk the ring from pi+1 to pi-1 (wrapping)
    for step in 1..ring_size {
        let i = (real_index + step) % ring_size;
        let c_i = challenges[i];

        // Random responses for this index
        let r_i_0 = random_scalar();
        let r_i_1 = random_scalar();
        responses[2 * i] = r_i_0;
        responses[2 * i + 1] = r_i_1;

        // L_0 = r_{i,0} * G + c_i * P_i
        let l_0_i = (r_i_0 * RISTRETTO_BASEPOINT_POINT + c_i * ring_target_keys[i]).compress();

        // R_0 = r_{i,0} * Hp(P_i) + c_i * I
        let hp_i = hash_to_point(
            ONETIME_KEY_HASH_TO_POINT,
            ring[i].target_key.as_slice(),
        );
        let r_0_i = (r_i_0 * hp_i + c_i * key_image_point).compress();

        // Z_i = pseudo_output - C_i (MC convention: output - input)
        let z_i = pseudo_output_point - ring_commitments[i];

        // L_1 = r_{i,1} * G + c_i * Z_i
        let l_1_i = (r_i_1 * RISTRETTO_BASEPOINT_POINT + c_i * z_i).compress();

        // c_{i+1}
        let next_i = (i + 1) % ring_size;
        challenges[next_i] = mlsag_challenge(message, &key_image, &l_0_i, &r_0_i, &l_1_i);
    }

    // Close the ring at real_index
    let c_pi = challenges[real_index];
    responses[2 * real_index] = alpha_0 - c_pi * x;
    responses[2 * real_index + 1] = alpha_1 - c_pi * z;

    let sig = RingMLSAG {
        c_zero: challenges[0].as_bytes().to_vec(),
        responses: responses.iter().map(|s| s.as_bytes().to_vec()).collect(),
        key_image: key_image.as_bytes().to_vec(),
    };

    Ok((sig, pseudo_output))
}

/// Self-verify an MLSAG signature, mimicking MC's ring_signature_verify.
/// Returns Ok(()) if the signature verifies, or an error describing the failure.
fn verify_mlsag(
    message: &[u8; 32],
    ring: &[RingMember],
    pseudo_output: &CompressedRistretto,
    sig: &RingMLSAG,
) -> Result<(), JsError> {
    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{:02x}", b)).collect() };
    let ring_size = ring.len();

    let c_zero_bytes: [u8; 32] = sig.c_zero.as_slice().try_into()
        .map_err(|_| JsError::new("c_zero not 32 bytes"))?;
    let c_zero = Scalar::from_canonical_bytes(c_zero_bytes).into_option()
        .ok_or_else(|| JsError::new("c_zero not canonical scalar"))?;

    let key_image = CompressedRistretto::from_slice(&sig.key_image)
        .map_err(|_| JsError::new("key_image not 32 bytes"))?;
    let key_image_point = key_image.decompress()
        .ok_or_else(|| JsError::new("key_image not valid point"))?;

    let pseudo_output_point = pseudo_output.decompress()
        .ok_or_else(|| JsError::new("pseudo_output not valid point"))?;

    let mut c_cur = c_zero;

    for i in 0..ring_size {
        let p_i = decompress(&ring[i].target_key)?;
        let c_i = decompress(&ring[i].commitment)?;

        let r_0_bytes: [u8; 32] = sig.responses[2 * i].as_slice().try_into()
            .map_err(|_| JsError::new("response not 32 bytes"))?;
        let r_0 = Scalar::from_canonical_bytes(r_0_bytes).into_option()
            .ok_or_else(|| JsError::new(&format!("response[{}] not canonical", 2*i)))?;

        let r_1_bytes: [u8; 32] = sig.responses[2 * i + 1].as_slice().try_into()
            .map_err(|_| JsError::new("response not 32 bytes"))?;
        let r_1 = Scalar::from_canonical_bytes(r_1_bytes).into_option()
            .ok_or_else(|| JsError::new(&format!("response[{}] not canonical", 2*i+1)))?;

        // L_0 = r_0 * G + c_cur * P_i
        let l_0 = (r_0 * RISTRETTO_BASEPOINT_POINT + c_cur * p_i).compress();

        // R_0 = r_0 * Hp(P_i) + c_cur * key_image
        let hp_i = hash_to_point(ONETIME_KEY_HASH_TO_POINT, ring[i].target_key.as_slice());
        let r_0_point = (r_0 * hp_i + c_cur * key_image_point).compress();

        // Z_i = pseudo_output - C_i
        let z_i = pseudo_output_point - c_i;

        // L_1 = r_1 * G + c_cur * Z_i
        let l_1 = (r_1 * RISTRETTO_BASEPOINT_POINT + c_cur * z_i).compress();

        c_cur = mlsag_challenge(message, &key_image, &l_0, &r_0_point, &l_1);
    }

    if c_cur == c_zero {
        web_sys::console::log_1(&"[WASM] MLSAG self-verify: PASSED ✓".into());
        Ok(())
    } else {
        web_sys::console::log_1(&format!(
            "[WASM] MLSAG self-verify: FAILED ✗\n  c_zero:    {}\n  c_result:  {}",
            hex(c_zero.as_bytes()), hex(c_cur.as_bytes())
        ).into());
        Err(JsError::new(&format!(
            "MLSAG self-verify FAILED: c_zero={} c_result={}",
            hex(c_zero.as_bytes()), hex(c_cur.as_bytes())
        )))
    }
}

/// Compute the MLSAG challenge hash.
///
/// Matches mc-crypto-ring-signature challenge():
/// H = Blake2b512("mc_ring_mlsag_challenge" || message || key_image || L_0 || R_0 || L_1) -> Scalar
/// Note: ring_index is NOT included in the hash (verified against MC source).
fn mlsag_challenge(
    message: &[u8; 32],
    key_image: &CompressedRistretto,
    l_onetime: &CompressedRistretto,
    r_onetime: &CompressedRistretto,
    l_commitment: &CompressedRistretto,
) -> Scalar {
    let mut hasher = Blake2b512::new();
    hasher.update(MLSAG_CHALLENGE_TAG);
    hasher.update(message);
    hasher.update(key_image.as_bytes());
    hasher.update(l_onetime.as_bytes());
    hasher.update(r_onetime.as_bytes());
    hasher.update(l_commitment.as_bytes());
    Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
}

// ── Input selection ──

/// Simple input selection: pick the fewest TxOuts that cover amount + fee.
/// Returns selected indices and total value.
fn select_inputs(
    owned_txouts: &[OwnedTxOutInput],
    amount: u64,
    fee: u64,
) -> Result<(Vec<usize>, u64), JsError> {
    let needed = amount.checked_add(fee)
        .ok_or_else(|| JsError::new("Amount + fee overflow"))?;

    // Sort by value descending for greedy selection
    let mut indexed: Vec<(usize, u64)> = owned_txouts.iter()
        .enumerate()
        .map(|(i, t)| (i, t.value))
        .collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1));

    let mut selected = Vec::new();
    let mut total = 0u64;

    for (idx, val) in indexed {
        selected.push(idx);
        total += val;
        if total >= needed {
            return Ok((selected, total));
        }
    }

    Err(JsError::new(&format!(
        "Insufficient balance: have {} picoMOB, need {} picoMOB",
        total, needed
    )))
}

// ── Main transaction builder ──

/// Build a complete MobileCoin transaction.
///
/// Inputs:
///   - inputs: owned TxOuts with rings already assembled by the caller
///   - recipient: destination public address
///   - amount: picoMOB to send
///   - fee: transaction fee in picoMOB
///   - change_recipient: our own subaddress for receiving change
///   - tombstone_block: block after which tx expires
///   - fog_ingest_pubkey: optional fog ingest enclave public key (from fog report)
///
/// Returns a BuiltTransaction ready for serialization and submission.
/// Build a complete MobileCoin transaction with optional encrypted memos.
///
/// When `payment_request_id` is non-zero, the recipient output carries an
/// AuthenticatedSenderWithPaymentRequestMemo (type 0x0101) and the change
/// output carries a DestinationMemo (type 0x0200). When zero, both outputs
/// use default (zero) memos for backwards compatibility.
#[wasm_bindgen]
pub fn build_transaction(
    account_key_js: JsValue,
    inputs_js: JsValue,
    recipient_js: JsValue,
    amount: u64,
    fee: u64,
    change_recipient_js: JsValue,
    tombstone_block: u64,
    fog_ingest_pubkey_js: JsValue,
    payment_request_id: u64,
) -> Result<JsValue, JsError> {
    // Deserialize account key to extract view/spend private keys
    #[derive(Deserialize)]
    struct AccountKeyParts {
        view_private_key: Vec<u8>,
        spend_private_key: Vec<u8>,
    }
    let account_key: AccountKeyParts = serde_wasm_bindgen::from_value(account_key_js)?;
    let view_bytes: [u8; 32] = account_key.view_private_key.as_slice().try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let view_private = scalar_from_canonical(&view_bytes, "view")?;
    let spend_bytes: [u8; 32] = account_key.spend_private_key.as_slice().try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let spend_private = scalar_from_canonical(&spend_bytes, "spend")?;

    let inputs: Vec<OwnedTxOutInput> = serde_wasm_bindgen::from_value(inputs_js)?;
    let recipient: Recipient = serde_wasm_bindgen::from_value(recipient_js)?;
    let change_recipient: Recipient = serde_wasm_bindgen::from_value(change_recipient_js)?;
    let fog_ingest_pubkey: Option<Vec<u8>> = serde_wasm_bindgen::from_value(fog_ingest_pubkey_js)?;
    // Derive default subaddress (index 0) view public key: C_0 = a * D_0
    // where D_0 = (Hs("mc_subaddress" || a || 0) + b) * G.
    // Used in fog hints for change outputs so fog ingest can route them via KexRng.
    // Note: C_0 ≠ a*G — it's a*D_0 because MobileCoin uses subaddress derivation for ALL indices.
    let hs_0 = {
        let mut hasher = Blake2b512::new();
        hasher.update(b"mc_subaddress");
        hasher.update(view_private.as_bytes());
        hasher.update(Scalar::from(0u64).as_bytes());
        Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
    };
    let d_0 = (hs_0 + spend_private) * RISTRETTO_BASEPOINT_POINT;
    let default_subaddr_view_pub = (view_private * d_0).compress().as_bytes().to_vec();

    if inputs.is_empty() {
        return Err(JsError::new("No inputs provided"));
    }
    if amount == 0 {
        return Err(JsError::new("Amount must be > 0"));
    }

    let fog_pk = fog_ingest_pubkey.as_deref();

    // ── Select inputs ──
    let (selected_indices, total_input) = select_inputs(&inputs, amount, fee)?;
    let change_amount = total_input - amount - fee;

    // ── Build memos ──
    //
    // When payment_request_id != 0:
    //   Recipient output: AuthenticatedSenderWithPaymentRequestMemo (0x0101)
    //   Change output:    DestinationMemo (0x0200)
    // When payment_request_id == 0:
    //   Both outputs: default zero-byte memos

    // Sender's default subaddress address hash (for AuthenticatedSenderMemo)
    let sender_address_hash = compute_address_hash(
        &default_subaddr_view_pub,
        &d_0.compress().as_bytes().to_vec(),
    );

    // Recipient's address hash (for DestinationMemo)
    let recipient_address_hash = compute_address_hash(
        &recipient.view_public_key,
        &recipient.spend_public_key,
    );

    let recipient_memo = if payment_request_id != 0 {
        let memo = build_authenticated_sender_memo(
            &spend_private, &sender_address_hash, &recipient,
            payment_request_id,
        )?;
        Some(memo)
    } else {
        None
    };

    let change_memo = if payment_request_id != 0 {
        let total_outlay = amount + fee;
        Some(build_destination_memo(&recipient_address_hash, fee, total_outlay))
    } else {
        None
    };

    // ── Build outputs ──
    let mut outputs = Vec::new();

    // Output 0: recipient
    let (recipient_output, recipient_shared_secret) = build_tx_out_inner(
        &recipient, amount, TOKEN_ID_MOB, fog_pk, None,
        recipient_memo.as_ref(),
    )?;
    let confirmation_number = compute_confirmation_number(
        &recipient_shared_secret, &recipient_output.public_key,
    );
    outputs.push(recipient_output);

    // Output 1: change (only if non-zero)
    // Fog hint for change uses default subaddress view pub C_0 (not C_change)
    // so fog ingest can route it to our account via KexRng.
    if change_amount > 0 {
        let (change_output, _) = build_tx_out_inner(
            &change_recipient, change_amount, TOKEN_ID_MOB, fog_pk,
            Some(&default_subaddr_view_pub),
            change_memo.as_ref(),
        )?;
        outputs.push(change_output);
    }

    // Sort outputs by public_key, matching MobileCoin's validation:
    //   validate_outputs_are_sorted: |a, b| a.public_key < b.public_key
    outputs.sort_by(|a, b| a.public_key.cmp(&b.public_key));

    // ── Generate pseudo-output blindings ──
    // The sum of pseudo-output blindings must equal the sum of output blindings
    // (so that the balance equation holds: sum(input_commitments) = sum(output_commitments) + fee*H)
    //
    // For n inputs: pseudo_blinding[0..n-2] are random, pseudo_blinding[n-1] = sum(output_blindings) - sum(pseudo_blinding[0..n-2])
    // Sort each input's ring by public_key, matching MobileCoin's validation:
    //   validate_ring_elements_are_sorted: |a, b| a.public_key < b.public_key
    // See: mobilecoin/transaction/core/src/validation/validate.rs
    // We must sort before computing the prefix hash and MLSAG signatures, and update
    // real_index to track the real member's new position in the sorted ring.
    let selected_inputs: Vec<OwnedTxOutInput> = selected_indices.iter().map(|&i| {
        let input = &inputs[i];
        let mut indexed_ring: Vec<(usize, &RingMember)> = input.ring.iter().enumerate().collect();
        indexed_ring.sort_by(|a, b| a.1.public_key.cmp(&b.1.public_key));
        let new_real_index = indexed_ring.iter().position(|(orig_idx, _)| *orig_idx == input.real_index)
            .expect("real_index must be in ring");
        let sorted_ring: Vec<RingMember> = indexed_ring.into_iter().map(|(_, m)| m.clone()).collect();
        OwnedTxOutInput {
            real_index: new_real_index,
            ring: sorted_ring,
            subaddress_index: input.subaddress_index,
            value: input.value,
            token_id: input.token_id,
        }
    }).collect();

    // Sort inputs by the public_key of their first ring element (after ring sorting).
    // See: validate_inputs_are_sorted in mobilecoin/transaction/core/src/validation/validate.rs
    let mut selected_inputs = selected_inputs;
    selected_inputs.sort_by(|a, b| {
        let a_pk = a.ring.first().map(|m| m.public_key.as_slice()).unwrap_or(&[]);
        let b_pk = b.ring.first().map(|m| m.public_key.as_slice()).unwrap_or(&[]);
        a_pk.cmp(b_pk)
    });

    let n_inputs = selected_inputs.len();

    // Sum of output blindings
    let mut output_blinding_sum = Scalar::ZERO;
    for o in &outputs {
        let bytes: [u8; 32] = o.blinding.as_slice().try_into()
            .map_err(|_| JsError::new("Invalid output blinding length"))?;
        let s = Scalar::from_canonical_bytes(bytes)
            .into_option()
            .ok_or_else(|| JsError::new("Non-canonical output blinding scalar"))?;
        output_blinding_sum += s;
    }

    // Add fee * 0 (fee has zero blinding by convention, so fee doesn't affect blinding sum)
    // Actually: the balance equation is sum(pseudo_output) = sum(output_commitment) + fee * H
    // So: sum(pseudo_blinding) * G + sum(value_pseudo) * H = sum(output_blinding) * G + sum(output_value) * H + fee * H
    // Since value_pseudo[i] = input[i].value, and sum(input_value) = sum(output_value) + fee:
    // We need: sum(pseudo_blinding) = sum(output_blinding)

    let mut pseudo_blindings = Vec::with_capacity(n_inputs);
    let mut pseudo_blinding_sum = Scalar::ZERO;

    for i in 0..n_inputs {
        if i < n_inputs - 1 {
            let pb = random_scalar();
            pseudo_blinding_sum += pb;
            pseudo_blindings.push(pb);
        } else {
            // Last pseudo-blinding ensures sum matches
            let last_pb = output_blinding_sum - pseudo_blinding_sum;
            pseudo_blindings.push(last_pb);
        }
    }

    // ── Build pseudo-outputs and prepare for prefix hash ──
    let h_token = token_generator(TOKEN_ID_MOB);
    let mut input_ring_data: Vec<(&[RingMember], Vec<u8>)> = Vec::new();

    for (i, input) in selected_inputs.iter().enumerate() {
        let pseudo_output = (Scalar::from(input.value) * h_token + pseudo_blindings[i] * RISTRETTO_BASEPOINT_POINT).compress();
        input_ring_data.push((&input.ring, pseudo_output.as_bytes().to_vec()));
    }

    // ── Compute TxPrefix hash ──
    let prefix_refs: Vec<(&[RingMember], &[u8])> = input_ring_data.iter()
        .map(|(ring, po)| (*ring, po.as_slice()))
        .collect();
    let tx_prefix_hash = compute_tx_prefix_hash(&prefix_refs, &outputs, fee, tombstone_block, TOKEN_ID_MOB);

    // ── Bulletproofs range proof for pseudo-outputs + outputs ──
    // MC verifies the range proof against ALL commitments for a token:
    //   commitments = pseudo_output_commitments ++ output_commitments
    // Must be computed BEFORE the signing digest, because the signing digest
    // includes the range proof bytes (MobileCoin block version >= 2).
    //
    // Order: pseudo-outputs first (in input order), then outputs (sorted by public_key)
    let mut all_rp_values: Vec<u64> = Vec::new();
    let mut all_rp_blindings: Vec<Scalar> = Vec::new();

    // Pseudo-output values and blindings (one per input)
    for (i, input) in selected_inputs.iter().enumerate() {
        all_rp_values.push(input.value);
        all_rp_blindings.push(pseudo_blindings[i]);
    }

    // Output values and blindings (sorted output order)
    for output in &outputs {
        all_rp_values.push(output.value);
        let bytes: [u8; 32] = output.blinding.as_slice().try_into().unwrap();
        all_rp_blindings.push(
            Scalar::from_canonical_bytes(bytes)
                .into_option()
                .ok_or_else(|| JsError::new("Non-canonical output blinding scalar in range proof"))?
        );
    }

    // Use MC-style generators: B = H_token, B_blinding = RISTRETTO_BASEPOINT_POINT
    let mc_gens = crate::bulletproofs::PedersenGens::for_token(h_token);
    let range_proof = crate::bulletproofs::prove_range_with_generators(&all_rp_values, &all_rp_blindings, &mc_gens);
    let range_proof_bytes = range_proof.to_bytes();

    // ── Compute MLSAG signing digest (multi-layer) ──
    // MobileCoin block version >= 3 wraps the TxPrefix hash in additional Merlin
    // transcript layers that include pseudo-output commitments, range proof bytes,
    // and a TxSummary. The MLSAG signs this final digest, not the raw TxPrefix hash.
    let pseudo_output_refs: Vec<&[u8]> = input_ring_data.iter()
        .map(|(_, po)| po.as_slice())
        .collect();
    // Block v3+: range_proof_bytes is EMPTY, range_proofs has one entry (for single-token MOB tx)
    let range_proofs_vec: Vec<&[u8]> = vec![range_proof_bytes.as_slice()];
    let mlsag_signing_digest = crate::digestible::compute_mlsag_signing_digest(
        &tx_prefix_hash,
        &pseudo_output_refs,
        &[],               // range_proof_bytes: EMPTY for block v3+
        &range_proofs_vec, // range_proofs: one proof for MOB-only tx
        &outputs,
        fee,
        TOKEN_ID_MOB,  // fee_token_id
        tombstone_block,
    );

    // ── Sign each input with MLSAG ──
    let mut signed_inputs = Vec::new();

    for (i, input) in selected_inputs.iter().enumerate() {
        // Derive onetime private key from account key + real member's tx_out public_key
        let real_pub_key = &input.ring[input.real_index].public_key;
        let tx_pub = decompress(real_pub_key)?;
        let shared_secret = (view_private * tx_pub).compress();
        let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());
        // d_i = Hs("mc_subaddress" || a || Scalar::from(subaddr_idx)) + b
        let mut hasher_sub = Blake2b512::new();
        hasher_sub.update(b"mc_subaddress");
        hasher_sub.update(view_private.as_bytes());
        hasher_sub.update(Scalar::from(input.subaddress_index).as_bytes());
        let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher_sub.finalize().into());
        let d_i = hs_sub + spend_private;
        let onetime_scalar = hs + d_i;

        // Derive blinding factor from shared secret
        let mut amount_hasher = Blake2b512::new();
        amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
        amount_hasher.update(shared_secret.as_bytes());
        let amount_hash = amount_hasher.finalize();
        let amount_shared_secret = &amount_hash[..32];
        let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);
        let mut blinding_bytes = [0u8; 64];
        hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
            .map_err(|_| JsError::new("HKDF expand failed for input blinding"))?;
        let input_blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

        let (mlsag_sig, pseudo_output) = sign_mlsag(
            &mlsag_signing_digest,
            &input.ring,
            input.real_index,
            &onetime_scalar,
            input.value,
            &input_blinding,
            &pseudo_blindings[i],
            input.token_id,
        )?;

        // Self-verify the MLSAG signature (same check MC consensus performs)
        verify_mlsag(&mlsag_signing_digest, &input.ring, &pseudo_output, &mlsag_sig)?;

        signed_inputs.push(SignedInput {
            ring: input.ring.clone(),
            pseudo_output: pseudo_output.as_bytes().to_vec(),
            mlsag: mlsag_sig,
        });
    }

    // ── Strip blinding from output before returning ──
    // (blinding is internal to the builder, not part of the wire format)
    let wire_outputs: Vec<BuiltTxOut> = outputs.into_iter().map(|mut o| {
        o.blinding = Vec::new(); // clear for wire format
        o
    }).collect();

    let tx = BuiltTransaction {
        inputs: signed_inputs,
        outputs: wire_outputs,
        fee,
        tombstone_block,
        tx_prefix_hash: tx_prefix_hash.to_vec(),
        range_proof,
    };

    // Encode the full Tx as protobuf bytes for consensus submission
    let tx_bytes = encode_tx(&tx);

    // Round-trip verification (debug builds only — validates our protobuf encoding)
    #[cfg(debug_assertions)]
    {
        let empty_range_proof_bytes: &[u8] = &[];
        verify_tx_prefix_hash_round_trip(&tx_bytes, &tx_prefix_hash, fee, tombstone_block, &mlsag_signing_digest, &pseudo_output_refs, empty_range_proof_bytes, &range_proofs_vec, &tx.outputs, TOKEN_ID_MOB)?;
    }

    // Extract key images for spend tracking
    let key_images: Vec<Vec<u8>> = tx.inputs.iter()
        .map(|input| input.mlsag.key_image.clone())
        .collect();

    let result = TxBuildResult {
        tx_bytes,
        tx_prefix_hash: tx.tx_prefix_hash,
        key_images,
        confirmation_number,
    };

    Ok(serde_wasm_bindgen::to_value(&result)?)
}

/// Derive the one-time private key for a known owned TxOut.
///
/// This is needed when building transaction inputs. Given:
///   - view_private_key (a)
///   - spend_private_key (b)
///   - subaddress_index
///   - tx_out_public_key (R)
///
/// Returns: onetime_private_key = Hs(a*R) + Hs_sub(a, index) + b
#[wasm_bindgen]
pub fn derive_onetime_private_key(
    view_private_key: &[u8],
    spend_private_key: &[u8],
    subaddress_index: u64,
    tx_out_public_key: &[u8],
) -> Result<Vec<u8>, JsError> {
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = spend_private_key.try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let b = scalar_from_canonical(&spend_bytes, "spend")?;

    let tx_pub = decompress(tx_out_public_key)?;

    // shared secret hs = H_s(a * R)
    let shared_secret = (a * tx_pub).compress();
    let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());

    // subaddress spend private key:
    //   d_i = Hs("mc_subaddress" || a || Scalar::from(i)) + b
    // ALL indices use the same formula. Index serialized as Scalar (32 bytes).
    // Reference: mc-core/src/subaddress.rs
    let mut hasher_sub = Blake2b512::new();
    hasher_sub.update(b"mc_subaddress");
    hasher_sub.update(a.as_bytes());
    hasher_sub.update(Scalar::from(subaddress_index).as_bytes());
    let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher_sub.finalize().into());
    let d_i = hs_sub + b;

    // onetime_private_key = hs + d_i
    let onetime = hs + d_i;

    Ok(onetime.as_bytes().to_vec())
}

/// Diagnostic: verify onetime key derivation against a known target_key.
///
/// Returns a JSON string with intermediate values for debugging.
/// If the derivation is correct, returns {"ok": true}.
/// If wrong, returns {"ok": false, ...details...}.
#[wasm_bindgen]
pub fn debug_verify_onetime_key(
    view_private_key: &[u8],
    spend_private_key: &[u8],
    subaddress_index: u64,
    tx_out_public_key: &[u8],
    expected_target_key: &[u8],
) -> Result<String, JsError> {
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = spend_private_key.try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let b = scalar_from_canonical(&spend_bytes, "spend")?;

    let tx_pub = decompress(tx_out_public_key)?;
    let shared_secret = (a * tx_pub).compress();
    let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());

    let mut hasher_sub = Blake2b512::new();
    hasher_sub.update(b"mc_subaddress");
    hasher_sub.update(a.as_bytes());
    hasher_sub.update(Scalar::from(subaddress_index).as_bytes());
    let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher_sub.finalize().into());
    let d_i = hs_sub + b;

    let x = hs + d_i;
    let x_g = (x * RISTRETTO_BASEPOINT_POINT).compress();
    let hs_g = (hs * RISTRETTO_BASEPOINT_POINT).compress();
    let d_i_g = (d_i * RISTRETTO_BASEPOINT_POINT).compress();
    let b_g = (b * RISTRETTO_BASEPOINT_POINT).compress();

    // Also compute candidate_d = target - hs*G (what scanning does)
    let target = decompress(expected_target_key)?;
    let candidate_d = (target - hs * RISTRETTO_BASEPOINT_POINT).compress();

    let hex = |bytes: &[u8]| -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    };

    let ok = x_g.as_bytes() == expected_target_key;

    // Check all subaddresses 0..4 to find which one actually matches
    let mut matching_subaddr: i64 = -1;
    for idx in 0u64..4 {
        let d_test = {
            let mut hasher = Blake2b512::new();
            hasher.update(b"mc_subaddress");
            hasher.update(a.as_bytes());
            hasher.update(Scalar::from(idx).as_bytes());
            let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher.finalize().into());
            (hs_sub + b) * RISTRETTO_BASEPOINT_POINT
        };
        if d_test.compress() == candidate_d {
            matching_subaddr = idx as i64;
            break;
        }
    }

    Ok(format!(
        "{{\"ok\":{},\"subaddr_idx\":{},\"matching_subaddr\":{},\"target\":\"{}\",\"xG\":\"{}\",\"hsG\":\"{}\",\"diG\":\"{}\",\"bG\":\"{}\",\"candidate_d\":\"{}\",\"R\":\"{}\"}}",
        ok, subaddress_index, matching_subaddr,
        hex(expected_target_key), hex(x_g.as_bytes()),
        hex(hs_g.as_bytes()), hex(d_i_g.as_bytes()),
        hex(b_g.as_bytes()), hex(candidate_d.as_bytes()),
        hex(tx_out_public_key),
    ))
}

/// Derive the blinding factor for an owned TxOut's commitment.
///
/// This recovers the original blinding factor used in the Pedersen commitment,
/// which is needed for MLSAG signing.
///
/// Given: view_private_key (a), tx_out_public_key (R)
/// Returns: 32-byte blinding factor scalar
#[wasm_bindgen]
pub fn derive_tx_out_blinding(
    view_private_key: &[u8],
    tx_out_public_key: &[u8],
) -> Result<Vec<u8>, JsError> {
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let tx_pub = decompress(tx_out_public_key)?;

    // shared_secret = a * R
    let shared_secret = (a * tx_pub).compress();

    // amount shared secret
    let mut amount_hasher = Blake2b512::new();
    amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
    amount_hasher.update(shared_secret.as_bytes());
    let amount_hash = amount_hasher.finalize();
    let amount_shared_secret = &amount_hash[..32];

    // HKDF to derive blinding
    let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);
    let mut blinding_bytes = [0u8; 64];
    hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for blinding"))?;
    let blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

    Ok(blinding.as_bytes().to_vec())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bulletproofs::{InnerProductProof, RangeProof};

    /// Build a minimal BuiltTransaction for testing encode_tx.
    fn make_test_tx() -> BuiltTransaction {
        let ring_member = RingMember {
            target_key: vec![0xAA; 32],
            public_key: vec![0xBB; 32],
            commitment: vec![0xCC; 32],
            tx_out_bytes: vec![0x0A, 0x04, 0x01, 0x02, 0x03, 0x04], // fake TxOut protobuf
            proof_bytes: vec![0x12, 0x03, 0x05, 0x06, 0x07],        // fake proof protobuf
        };

        let mlsag = RingMLSAG {
            c_zero: vec![0x11; 32],
            responses: vec![vec![0x22; 32], vec![0x33; 32]],
            key_image: vec![0x44; 32],
        };

        let signed_input = SignedInput {
            ring: vec![ring_member],
            pseudo_output: vec![0x55; 32],
            mlsag,
        };

        let output = BuiltTxOut {
            target_key: vec![0x66; 32],
            public_key: vec![0x77; 32],
            masked_value: 42_000_000,
            masked_token_id: vec![0x00; 8],
            commitment: vec![0x88; 32],
            e_fog_hint: vec![0x99; 128],
            e_memo: vec![0xEE; 66],
            blinding: vec![0xDD; 32], // not in wire format
            value: 0, // not in wire format
        };

        let range_proof = RangeProof {
            a_point: vec![0xA0; 32],
            s_point: vec![0xA1; 32],
            t1_point: vec![0xA2; 32],
            t2_point: vec![0xA3; 32],
            t_x: vec![0xA4; 32],
            t_x_blinding: vec![0xA5; 32],
            e_blinding: vec![0xA6; 32],
            ipp_proof: InnerProductProof {
                l_vec: vec![vec![0xB0; 32]],
                r_vec: vec![vec![0xB1; 32]],
                a: vec![0xB2; 32],
                b: vec![0xB3; 32],
            },
        };

        BuiltTransaction {
            inputs: vec![signed_input],
            outputs: vec![output],
            fee: 400_000_000,
            tombstone_block: 1100,
            tx_prefix_hash: vec![0xFF; 32],
            range_proof,
        }
    }

    /// Minimal protobuf decoder for verifying encode_tx output.
    /// Returns (field_number, wire_type, data) tuples.
    fn decode_fields(buf: &[u8]) -> Vec<(u32, u32, Vec<u8>)> {
        let mut fields = Vec::new();
        let mut pos = 0;
        while pos < buf.len() {
            let (tag, new_pos) = decode_varint(buf, pos);
            pos = new_pos;
            let field_number = (tag >> 3) as u32;
            let wire_type = (tag & 0x7) as u32;
            match wire_type {
                0 => {
                    // varint
                    let (val, new_pos) = decode_varint(buf, pos);
                    pos = new_pos;
                    fields.push((field_number, wire_type, val.to_le_bytes().to_vec()));
                }
                1 => {
                    // fixed64
                    let data = buf[pos..pos + 8].to_vec();
                    pos += 8;
                    fields.push((field_number, wire_type, data));
                }
                2 => {
                    // length-delimited
                    let (len, new_pos) = decode_varint(buf, pos);
                    pos = new_pos;
                    let data = buf[pos..pos + len as usize].to_vec();
                    pos += len as usize;
                    fields.push((field_number, wire_type, data));
                }
                _ => panic!("unsupported wire type {wire_type}"),
            }
        }
        fields
    }

    fn decode_varint(buf: &[u8], mut pos: usize) -> (u64, usize) {
        let mut result: u64 = 0;
        let mut shift = 0;
        loop {
            let b = buf[pos] as u64;
            pos += 1;
            result |= (b & 0x7F) << shift;
            if b & 0x80 == 0 {
                break;
            }
            shift += 7;
        }
        (result, pos)
    }

    fn get_varint_field(fields: &[(u32, u32, Vec<u8>)], field_num: u32) -> u64 {
        for (num, wt, data) in fields {
            if *num == field_num && *wt == 0 {
                return u64::from_le_bytes(data[..8].try_into().unwrap());
            }
        }
        0
    }

    fn get_submessages(fields: &[(u32, u32, Vec<u8>)], field_num: u32) -> Vec<Vec<u8>> {
        fields.iter()
            .filter(|(num, wt, _)| *num == field_num && *wt == 2)
            .map(|(_, _, data)| data.clone())
            .collect()
    }

    #[test]
    fn test_encode_tx_structure() {
        let tx = make_test_tx();
        let encoded = encode_tx(&tx);

        // Top level: Tx { prefix = 1, signature = 2 }
        let top = decode_fields(&encoded);
        let prefixes = get_submessages(&top, 1);
        let signatures = get_submessages(&top, 2);
        assert_eq!(prefixes.len(), 1, "expected 1 TxPrefix");
        assert_eq!(signatures.len(), 1, "expected 1 signature");

        // TxPrefix { inputs = 1, outputs = 2, fee = 3, tombstone_block = 4 }
        let prefix_fields = decode_fields(&prefixes[0]);
        let inputs = get_submessages(&prefix_fields, 1);
        let outputs = get_submessages(&prefix_fields, 2);
        let fee = get_varint_field(&prefix_fields, 3);
        let tombstone = get_varint_field(&prefix_fields, 4);

        assert_eq!(inputs.len(), 1, "expected 1 TxIn");
        assert_eq!(outputs.len(), 1, "expected 1 TxOut");
        assert_eq!(fee, 400_000_000);
        assert_eq!(tombstone, 1100);

        // TxIn should contain our opaque ring member bytes
        let tx_in_fields = decode_fields(&inputs[0]);
        let ring_txouts = get_submessages(&tx_in_fields, 1);
        let ring_proofs = get_submessages(&tx_in_fields, 2);
        assert_eq!(ring_txouts.len(), 1, "expected 1 ring TxOut");
        assert_eq!(ring_proofs.len(), 1, "expected 1 ring proof");
        // Verify opaque bytes passed through unchanged
        assert_eq!(ring_txouts[0], vec![0x0A, 0x04, 0x01, 0x02, 0x03, 0x04]);
        assert_eq!(ring_proofs[0], vec![0x12, 0x03, 0x05, 0x06, 0x07]);

        // TxOut should have masked_amount_v2 (6), target_key (2), public_key (3), e_fog_hint (4)
        let tx_out_fields = decode_fields(&outputs[0]);
        assert!(get_submessages(&tx_out_fields, 6).len() == 1, "expected masked_amount_v2");
        assert!(get_submessages(&tx_out_fields, 2).len() == 1, "expected target_key");
        assert!(get_submessages(&tx_out_fields, 3).len() == 1, "expected public_key");
        assert!(get_submessages(&tx_out_fields, 4).len() == 1, "expected e_fog_hint");
        assert!(get_submessages(&tx_out_fields, 5).len() == 1, "expected e_memo");

        // Signature: ring_signatures (1), pseudo_output_commitments (2), range_proofs (4)
        // Note: field 3 (range_proof_bytes) is omitted for block v3+; we use field 4 (range_proofs).
        let sig_fields = decode_fields(&signatures[0]);
        let ring_sigs = get_submessages(&sig_fields, 1);
        let pseudo_outputs = get_submessages(&sig_fields, 2);
        let range_proofs = get_submessages(&sig_fields, 4);
        assert_eq!(ring_sigs.len(), 1, "expected 1 RingMLSAG");
        assert_eq!(pseudo_outputs.len(), 1, "expected 1 pseudo_output_commitment");
        assert_eq!(range_proofs.len(), 1, "expected range_proofs");

        // Verify RingMLSAG structure: c_zero (1), responses (2), key_image (3)
        let mlsag_fields = decode_fields(&ring_sigs[0]);
        assert_eq!(get_submessages(&mlsag_fields, 1).len(), 1, "expected c_zero");
        assert_eq!(get_submessages(&mlsag_fields, 2).len(), 2, "expected 2 responses");
        assert_eq!(get_submessages(&mlsag_fields, 3).len(), 1, "expected key_image");

        // Verify range proof bytes length: 7*32 + 2*1*32 + 2*32 = 224+64+64 = 352
        assert_eq!(range_proofs[0].len(), 352);
    }

    #[test]
    fn test_encode_tx_out_masked_value() {
        let output = BuiltTxOut {
            target_key: vec![0x01; 32],
            public_key: vec![0x02; 32],
            masked_value: 0xDEADBEEF_CAFEBABE,
            masked_token_id: vec![0x03; 8],
            commitment: vec![0x04; 32],
            e_fog_hint: vec![0x05; 128],
            e_memo: vec![0x07; 66],
            blinding: vec![0x06; 32],
            value: 0,
        };
        let encoded = encode_tx_out(&output);
        let fields = decode_fields(&encoded);

        // masked_amount_v2 is field 6
        let masked_amount_data = get_submessages(&fields, 6);
        assert_eq!(masked_amount_data.len(), 1);

        // Inside masked_amount: commitment (1), masked_value fixed64 (2), masked_token_id (3)
        let ma_fields = decode_fields(&masked_amount_data[0]);
        // Check fixed64 field 2 contains our value
        let fixed64_fields: Vec<_> = ma_fields.iter()
            .filter(|(num, wt, _)| *num == 2 && *wt == 1)
            .collect();
        assert_eq!(fixed64_fields.len(), 1);
        let val = u64::from_le_bytes(fixed64_fields[0].2[..8].try_into().unwrap());
        assert_eq!(val, 0xDEADBEEF_CAFEBABE);
    }

    /// Round-trip test: build a TxOut via build_tx_out_inner, then verify
    /// a scanner with the recipient's keys can detect it.
    ///
    /// This is the test that would have caught the R = r*G bug (should be r*D_i).
    #[test]
    fn test_build_tx_out_round_trip_scan() {
        // Generate deterministic account keys for the recipient
        let a = Scalar::from_bytes_mod_order([
            1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
            17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,0
        ]); // view private
        let b = Scalar::from_bytes_mod_order([
            31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,
            15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0
        ]); // spend private

        // Derive default subaddress (index 0) keys:
        //   D_0 = (Hs("mc_subaddress" || a || 0) + b) * G
        //   C_0 = a * D_0
        let hs_0 = {
            let mut hasher = Blake2b512::new();
            hasher.update(b"mc_subaddress");
            hasher.update(a.as_bytes());
            hasher.update(Scalar::from(0u64).as_bytes());
            Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
        };
        let d_0_scalar = hs_0 + b;
        let d_0 = (d_0_scalar * RISTRETTO_BASEPOINT_POINT).compress();
        let c_0 = (a * d_0.decompress().unwrap()).compress();

        let recipient = Recipient {
            view_public_key: c_0.as_bytes().to_vec(),
            spend_public_key: d_0.as_bytes().to_vec(),
            fog_report_url: String::new(),
        };

        // Build a TxOut for this recipient
        let (tx_out, _shared_secret) = build_tx_out_inner(
            &recipient,
            1_000_000_000, // 1 MOB
            0,             // token_id = MOB
            None,          // no fog
            None,          // no fog hint override
            None,          // no memo
        ).expect("build_tx_out_inner should succeed");

        // Now simulate scanning: shared_secret = a * R where R = tx_out.public_key
        let r_point = CompressedRistretto::from_slice(&tx_out.public_key).unwrap()
            .decompress().unwrap();
        let shared_secret = (a * r_point).compress();

        // hs = Hs(shared_secret)
        let hs = {
            let mut hasher = Blake2b512::new();
            hasher.update(b"mc_onetime_key_hash_to_scalar");
            hasher.update(shared_secret.as_bytes());
            Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
        };

        // candidate_D = target_key - hs*G
        let target = CompressedRistretto::from_slice(&tx_out.target_key).unwrap()
            .decompress().unwrap();
        let candidate_d = (target - hs * RISTRETTO_BASEPOINT_POINT).compress();

        // Should match D_0 (the default subaddress spend key)
        assert_eq!(
            candidate_d, d_0,
            "Scanner must recover recipient's spend public key D_0 from the TxOut. \
             If this fails, tx_public_key derivation is wrong (likely R = r*G instead of r*D_i)."
        );

        // Also verify amount can be unmasked
        let mut amount_hasher = Blake2b512::new();
        amount_hasher.update(b"mc_amount_shared_secret");
        amount_hasher.update(shared_secret.as_bytes());
        let amount_hash = amount_hasher.finalize();
        let amount_shared_secret = &amount_hash[..32];

        let hk = Hkdf::<Sha512>::new(Some(b"mc_amount_blinding_factors"), amount_shared_secret);
        let mut value_mask = [0u8; 8];
        hk.expand(b"mc_amount_value", &mut value_mask).unwrap();
        let unmasked_value = tx_out.masked_value ^ u64::from_le_bytes(value_mask);
        assert_eq!(unmasked_value, 1_000_000_000, "Scanner must recover correct amount");
    }

    #[test]
    fn test_encode_tx_empty_fog_hint_omitted() {
        let output = BuiltTxOut {
            target_key: vec![0x01; 32],
            public_key: vec![0x02; 32],
            masked_value: 100,
            masked_token_id: vec![],
            commitment: vec![0x04; 32],
            e_fog_hint: vec![], // empty — should be omitted
            e_memo: vec![],    // empty — should be omitted
            blinding: vec![0x06; 32],
            value: 0,
        };
        let encoded = encode_tx_out(&output);
        let fields = decode_fields(&encoded);

        // e_fog_hint (field 4) should not appear
        assert_eq!(get_submessages(&fields, 4).len(), 0, "empty e_fog_hint should be omitted");
    }

    /// Round-trip test: build a TxOut with AuthenticatedSenderWithPaymentRequestMemo,
    /// then decrypt the memo and verify the type, address hash, payment_request_id, and HMAC.
    #[test]
    fn test_memo_round_trip_authenticated_sender() {
        // Sender keys
        let sender_a = Scalar::from_bytes_mod_order([
            10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,
            26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,0
        ]);
        let sender_b = Scalar::from_bytes_mod_order([
            40,39,38,37,36,35,34,33,32,31,30,29,28,27,26,25,
            24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,0
        ]);

        // Recipient keys
        let recip_a = Scalar::from_bytes_mod_order([
            1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
            17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,0
        ]);
        let recip_b = Scalar::from_bytes_mod_order([
            31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,
            15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0
        ]);

        // Derive recipient's default subaddress
        let recip_hs_0 = {
            let mut h = Blake2b512::new();
            h.update(b"mc_subaddress"); h.update(recip_a.as_bytes());
            h.update(Scalar::from(0u64).as_bytes());
            Scalar::from_bytes_mod_order_wide(&h.finalize().into())
        };
        let recip_d_0 = ((recip_hs_0 + recip_b) * RISTRETTO_BASEPOINT_POINT).compress();
        let recip_c_0 = (recip_a * recip_d_0.decompress().unwrap()).compress();

        let recipient = Recipient {
            view_public_key: recip_c_0.as_bytes().to_vec(),
            spend_public_key: recip_d_0.as_bytes().to_vec(),
            fog_report_url: String::new(),
        };

        // Derive sender's default subaddress for address hash
        let sender_hs_0 = {
            let mut h = Blake2b512::new();
            h.update(b"mc_subaddress"); h.update(sender_a.as_bytes());
            h.update(Scalar::from(0u64).as_bytes());
            Scalar::from_bytes_mod_order_wide(&h.finalize().into())
        };
        let sender_d_0 = ((sender_hs_0 + sender_b) * RISTRETTO_BASEPOINT_POINT).compress();
        let sender_c_0 = (sender_a * sender_d_0.decompress().unwrap()).compress();
        let sender_addr_hash = compute_address_hash(
            sender_c_0.as_bytes(), sender_d_0.as_bytes(),
        );

        let payment_request_id: u64 = 0xDEADBEEF_CAFE1234;
        let memo = build_authenticated_sender_memo(
            &sender_b, &sender_addr_hash, &recipient, payment_request_id,
        ).expect("memo construction should succeed");

        // Build a TxOut with this memo
        let (tx_out, shared_secret) = build_tx_out_inner(
            &recipient, 500_000_000, 0, None, None, Some(&memo),
        ).expect("build_tx_out_inner should succeed");

        // Decrypt the memo: XOR e_memo with HKDF key
        let memo_hk = Hkdf::<Sha512>::new(Some(MEMO_KEY_SALT), shared_secret.as_bytes());
        let mut memo_key = vec![0u8; MEMO_DATA_LEN];
        memo_hk.expand(b"", &mut memo_key).unwrap();
        let mut decrypted = [0u8; MEMO_DATA_LEN];
        for i in 0..MEMO_DATA_LEN {
            decrypted[i] = tx_out.e_memo[i] ^ memo_key[i];
        }

        // Verify type prefix
        assert_eq!(decrypted[0..2], MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST);

        // Verify sender address hash
        assert_eq!(&decrypted[2..18], &sender_addr_hash);

        // Verify payment request ID
        let recovered_id = u64::from_le_bytes(decrypted[18..26].try_into().unwrap());
        assert_eq!(recovered_id, payment_request_id);

        // Verify HMAC (last 8 bytes)
        assert_ne!(&decrypted[58..66], &[0u8; 8], "HMAC must not be all zeros");

        // Verify HMAC is correct by recomputing it
        {
            use hmac::{Hmac, Mac};
            let ecdh = (sender_b * recip_c_0.decompress().unwrap()).compress();
            let mut key_mac = <Hmac<Sha512>>::new_from_slice(ecdh.as_bytes()).unwrap();
            key_mac.update(SENDER_MEMO_CREDENTIAL_DOMAIN);
            let hmac_key = key_mac.finalize().into_bytes();
            let mut mac = <Hmac<Sha512>>::new_from_slice(&hmac_key).unwrap();
            mac.update(recip_d_0.as_bytes());
            let expected: [u8; 8] = mac.finalize().into_bytes()[..8].try_into().unwrap();
            assert_eq!(&decrypted[58..66], &expected, "HMAC must match recomputed value");
        }
    }

    /// Verify DestinationMemo construction.
    #[test]
    fn test_destination_memo() {
        let addr_hash = [0xAB; 16];
        let fee = 400_000_000u64;
        let total_outlay = 1_400_000_000u64;
        let memo = build_destination_memo(&addr_hash, fee, total_outlay);

        assert_eq!(memo[0..2], MEMO_TYPE_DESTINATION);
        assert_eq!(&memo[2..18], &addr_hash);
        assert_eq!(memo[18], 1); // num_recipients
        assert_eq!(u64::from_le_bytes(memo[19..27].try_into().unwrap()), fee);
        assert_eq!(u64::from_le_bytes(memo[27..35].try_into().unwrap()), total_outlay);
    }

    /// Verify confirmation number is deterministic and non-trivial.
    #[test]
    fn test_confirmation_number() {
        let shared_secret = CompressedRistretto::from_slice(&[0x42u8; 32]).unwrap();
        let tx_out_pub = vec![0x77u8; 32];

        let cn1 = compute_confirmation_number(&shared_secret, &tx_out_pub);
        let cn2 = compute_confirmation_number(&shared_secret, &tx_out_pub);
        assert_eq!(cn1.len(), 32);
        assert_eq!(cn1, cn2, "confirmation number must be deterministic");
        assert_ne!(cn1, vec![0u8; 32], "confirmation number must not be all zeros");

        // Different inputs → different confirmation number
        let cn3 = compute_confirmation_number(&shared_secret, &vec![0x88u8; 32]);
        assert_ne!(cn1, cn3);
    }

    /// Verify that build_tx_out_inner with no memo produces the same result as before
    /// (backwards compatibility — default zero-byte memo).
    #[test]
    fn test_default_memo_backwards_compat() {
        let a = Scalar::from_bytes_mod_order([
            1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
            17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,0
        ]);
        let b = Scalar::from_bytes_mod_order([
            31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,
            15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0
        ]);
        let hs_0 = {
            let mut h = Blake2b512::new();
            h.update(b"mc_subaddress"); h.update(a.as_bytes());
            h.update(Scalar::from(0u64).as_bytes());
            Scalar::from_bytes_mod_order_wide(&h.finalize().into())
        };
        let d_0 = ((hs_0 + b) * RISTRETTO_BASEPOINT_POINT).compress();
        let c_0 = (a * d_0.decompress().unwrap()).compress();

        let recipient = Recipient {
            view_public_key: c_0.as_bytes().to_vec(),
            spend_public_key: d_0.as_bytes().to_vec(),
            fog_report_url: String::new(),
        };

        // Build with no memo (default)
        let (tx_out, shared_secret) = build_tx_out_inner(
            &recipient, 1_000_000, 0, None, None, None,
        ).expect("build should succeed");

        // Decrypt — should be all zeros
        let memo_hk = Hkdf::<Sha512>::new(Some(MEMO_KEY_SALT), shared_secret.as_bytes());
        let mut memo_key = vec![0u8; MEMO_DATA_LEN];
        memo_hk.expand(b"", &mut memo_key).unwrap();
        let mut decrypted = [0u8; MEMO_DATA_LEN];
        for i in 0..MEMO_DATA_LEN {
            decrypted[i] = tx_out.e_memo[i] ^ memo_key[i];
        }
        assert_eq!(decrypted, [0u8; MEMO_DATA_LEN], "default memo must be all zeros");
    }
}

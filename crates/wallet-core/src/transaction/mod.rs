//! MobileCoin transaction construction.
//!
//! Split by responsibility:
//!   - `encode`: Protobuf wire encoding, normalization, round-trip verification
//!   - `output`: TxOut construction, memos, fog hints
//!   - `mlsag`:  MLSAG ring signatures (sign/verify)
//!   - `builder`: Transaction assembly, input selection, wasm entry points

mod builder;
mod encode;
mod mlsag;
mod output;

use blake2::{Blake2b512, Digest};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::sci::InputRules;

// Re-export for tests and other modules that need them
// These are only used in tests, so allow unused in non-test builds
#[allow(unused_imports)]
pub(crate) use encode::{encode_tx, encode_tx_out};
#[allow(unused_imports)]
pub(crate) use output::{
    build_authenticated_sender_memo, build_destination_memo, build_tx_out_inner,
    compute_address_hash, compute_confirmation_number,
};

// ── Domain separation tags (must match MobileCoin exactly) ──

/// Hash-to-scalar for one-time key derivation
pub(crate) const ONETIME_KEY_HASH_TO_SCALAR: &[u8] = b"mc_onetime_key_hash_to_scalar";

/// Hash-to-point for key images and token generators
pub(crate) const ONETIME_KEY_HASH_TO_POINT: &[u8] = b"mc_onetime_key_hash_to_point";

/// Amount shared secret derivation
pub(crate) const AMOUNT_SHARED_SECRET_TAG: &[u8] = b"mc_amount_shared_secret";

/// HKDF salt for amount blinding factors
pub(crate) const AMOUNT_BLINDING_SALT: &[u8] = b"mc_amount_blinding_factors";

/// HKDF info tags for value, token_id, and blinding masks
pub(crate) const AMOUNT_VALUE_INFO: &[u8] = b"mc_amount_value";
pub(crate) const AMOUNT_TOKEN_ID_INFO: &[u8] = b"mc_amount_token_id";
pub(crate) const AMOUNT_BLINDING_INFO: &[u8] = b"mc_amount_blinding";

/// MLSAG challenge domain tag
pub(crate) const MLSAG_CHALLENGE_TAG: &[u8] = b"mc_ring_mlsag_challenge";

/// HKDF salt for encrypted memo key derivation
pub(crate) const MEMO_KEY_SALT: &[u8] = b"mc-memo-okm";

/// Encrypted memo payload length (2-byte type + 64 bytes data)
pub(crate) const MEMO_DATA_LEN: usize = 66;

// ── Memo type constants (MobileCoin RTH memo spec) ──

/// 0x0101: AuthenticatedSenderWithPaymentRequestMemo
pub(crate) const MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST: [u8; 2] = [0x01, 0x01];

/// 0x0200: DestinationMemo — written on change output
pub(crate) const MEMO_TYPE_DESTINATION: [u8; 2] = [0x02, 0x00];

/// Domain tag for sender credential HMAC key derivation
pub(crate) const SENDER_MEMO_CREDENTIAL_DOMAIN: &[u8] = b"mc-memo-mac";

/// Token ID 0 = MOB
pub(crate) const TOKEN_ID_MOB: u64 = 0;

// ── Types ──

/// A TxOut in the ring (ring member from merkle proofs / ring samples)
#[derive(Serialize, Deserialize, Clone)]
pub struct RingMember {
    pub target_key: Vec<u8>, // 32-byte compressed Ristretto
    pub public_key: Vec<u8>, // 32-byte compressed Ristretto
    pub commitment: Vec<u8>, // 32-byte compressed Ristretto (Pedersen)
    #[serde(default)]
    pub tx_out_bytes: Vec<u8>,
    #[serde(default)]
    pub proof_bytes: Vec<u8>,
}

/// An owned TxOut that we want to spend
#[derive(Serialize, Deserialize, Clone)]
pub struct OwnedTxOutInput {
    pub real_index: usize,
    pub ring: Vec<RingMember>,
    pub subaddress_index: u64,
    pub value: u64,
    pub token_id: u64,
}

/// Recipient info for building an output
#[derive(Serialize, Deserialize, Clone)]
pub struct Recipient {
    pub view_public_key: Vec<u8>,
    pub spend_public_key: Vec<u8>,
    pub fog_report_url: String,
}

/// A built TxOut ready for inclusion in a transaction
#[derive(Serialize, Deserialize, Clone)]
pub struct BuiltTxOut {
    pub target_key: Vec<u8>, // 32-byte one-time public key
    pub public_key: Vec<u8>, // 32-byte tx public key R
    pub masked_value: u64,
    pub masked_token_id: Vec<u8>, // 8 bytes LE
    pub commitment: Vec<u8>,      // 32-byte Pedersen commitment
    pub e_fog_hint: Vec<u8>,      // 84 bytes
    pub e_memo: Vec<u8>,          // 66 bytes
    /// Blinding factor (needed for MLSAG, NOT in wire format)
    pub blinding: Vec<u8>,
    /// Plaintext value (NOT in wire format, used for range proof)
    #[serde(default)]
    pub value: u64,
}

/// MLSAG ring signature for a single input
#[derive(Serialize, Deserialize, Clone)]
pub struct RingMLSAG {
    pub c_zero: Vec<u8>,
    pub responses: Vec<Vec<u8>>,
    pub key_image: Vec<u8>,
}

/// A signed input
#[derive(Serialize, Deserialize, Clone)]
pub struct SignedInput {
    pub ring: Vec<RingMember>,
    pub input_rules: Option<InputRules>,
    pub pseudo_output: Vec<u8>,
    pub mlsag: RingMLSAG,
}

/// The complete built transaction
#[derive(Serialize, Deserialize)]
pub struct BuiltTransaction {
    pub inputs: Vec<SignedInput>,
    pub outputs: Vec<BuiltTxOut>,
    pub fee: u64,
    pub tombstone_block: u64,
    pub tx_prefix_hash: Vec<u8>,
    pub range_proof: crate::bulletproofs::RangeProof,
}

/// Result returned to JS from build_transaction
#[derive(Serialize)]
pub struct TxBuildResult {
    pub tx_bytes: Vec<u8>,
    pub tx_prefix_hash: Vec<u8>,
    pub key_images: Vec<Vec<u8>>,
    pub confirmation_number: Vec<u8>,
}

// ── Shared crypto helpers ──

/// Hash-to-scalar: Blake2b512(tag || data) -> Scalar
pub(crate) fn hash_to_scalar(tag: &[u8], data: &[u8]) -> Scalar {
    let mut hasher = Blake2b512::new();
    hasher.update(tag);
    hasher.update(data);
    Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
}

/// Hash-to-point: Blake2b512(tag || data) -> RistrettoPoint
pub(crate) fn hash_to_point(tag: &[u8], data: &[u8]) -> RistrettoPoint {
    let mut hasher = Blake2b512::new();
    hasher.update(tag);
    hasher.update(data);
    let hash_output: [u8; 64] = hasher.finalize().into();
    RistrettoPoint::from_uniform_bytes(&hash_output)
}

/// Decompress a 32-byte compressed Ristretto point
pub(crate) fn decompress(bytes: &[u8]) -> Result<RistrettoPoint, JsError> {
    let compressed = CompressedRistretto::from_slice(bytes)
        .map_err(|_| JsError::new("Invalid compressed point length"))?;
    compressed
        .decompress()
        .ok_or_else(|| JsError::new("Invalid Ristretto point"))
}

/// Compute the Pedersen generator for a given token ID.
///
/// H = Blake2b512("mc_onetime_key_hash_to_point" || (basepoint_compressed XOR token_id_le))
pub(crate) fn token_generator(token_id: u64) -> RistrettoPoint {
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
pub(crate) fn random_scalar() -> Scalar {
    let mut bytes = [0u8; 64];
    getrandom::getrandom(&mut bytes).expect("RNG failed");
    Scalar::from_bytes_mod_order_wide(&bytes)
}

/// Compute the TxPrefix hash (message signed by MLSAG).
pub(crate) fn compute_tx_prefix_hash(
    inputs: &[(&[RingMember], Option<&InputRules>)],
    outputs: &[BuiltTxOut],
    fee: u64,
    tombstone_block: u64,
) -> [u8; 32] {
    crate::digestible::compute_tx_prefix_hash_merlin(inputs, outputs, fee, tombstone_block)
}

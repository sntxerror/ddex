//! View-key scanning, amount unmasking, and key image computation.
//!
//! Implements the MobileCoin CryptoNote-style protocol for detecting
//! owned TxOuts and computing the data needed to spend them.

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use blake2::{Blake2b512, Digest};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use hkdf::{Hkdf, SimpleHkdf};
use sha2::Sha512;
use aes_gcm::{Aes256Gcm, KeyInit, aead::{AeadInPlace, Nonce, Tag}};

use crate::keys::scalar_from_canonical;

// ── Domain separation tags (must match MobileCoin exactly) ──

const HASH_TO_SCALAR_TAG: &[u8] = b"mc_onetime_key_hash_to_scalar";
const HASH_TO_POINT_TAG: &[u8] = b"mc_onetime_key_hash_to_point";
const AMOUNT_SHARED_SECRET_TAG: &[u8] = b"mc_amount_shared_secret";
const AMOUNT_BLINDING_SALT: &[u8] = b"mc_amount_blinding_factors";
const AMOUNT_VALUE_INFO: &[u8] = b"mc_amount_value";
const AMOUNT_TOKEN_ID_INFO: &[u8] = b"mc_amount_token_id";
const AMOUNT_BLINDING_INFO: &[u8] = b"mc_amount_blinding";

/// HKDF salt for memo key derivation (must match transaction.rs)
const MEMO_KEY_SALT: &[u8] = b"mc-memo-okm";
const MEMO_DATA_LEN: usize = 66;

/// A TxOut from the ledger, as received from fog-view
#[derive(Serialize, Deserialize, Clone)]
pub struct TxOutData {
    pub target_key: Vec<u8>,        // 32 bytes compressed Ristretto
    pub public_key: Vec<u8>,        // 32 bytes compressed Ristretto
    pub masked_value: u64,
    pub masked_token_id: Vec<u8>,   // 8 bytes LE
    pub commitment: Vec<u8>,        // 32 bytes compressed Ristretto
    pub global_index: u64,
    pub block_index: u64,
    #[serde(default)]
    pub e_memo: Vec<u8>,            // 66 bytes encrypted memo (empty for old TxOuts)
}

/// Decoded memo from an encrypted TxOut memo field
#[derive(Serialize, Deserialize)]
pub struct DecodedMemo {
    /// Memo type prefix as u16 (e.g. 0x0000, 0x0100, 0x0101, 0x0200)
    pub memo_type: u16,
    /// Sender's short address hash (16 bytes) — types 0x0100, 0x0101
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_address_hash: Option<Vec<u8>>,
    /// Payment request ID — type 0x0101 only
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_request_id: Option<u64>,
    /// Destination address hash (16 bytes) — type 0x0200
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_address_hash: Option<Vec<u8>>,
    /// Total outlay in picoMOB — type 0x0200
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_outlay: Option<u64>,
}

/// Result of scanning a TxOut - only returned if it belongs to us
#[derive(Serialize, Deserialize)]
pub struct ScanResult {
    pub owned: bool,
    pub subaddress_index: Option<u64>,
    pub value: Option<u64>,
    pub token_id: Option<u64>,
    pub key_image: Option<Vec<u8>>,  // 32 bytes compressed Ristretto
    pub global_index: u64,
    pub block_index: u64,
    /// Decoded memo content (None if no e_memo or decryption failed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<DecodedMemo>,
}

/// Hash-to-scalar: Blake2b512(tag || compressed_point) -> Scalar
fn hash_to_scalar(tag: &[u8], point: &CompressedRistretto) -> Scalar {
    let mut hasher = Blake2b512::new();
    hasher.update(tag);
    hasher.update(point.as_bytes());
    Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
}

/// Hash-to-point: Blake2b512(tag || data) -> 64 bytes -> RistrettoPoint
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

/// Scan a single TxOut to check if it belongs to the given account.
///
/// Algorithm:
///   1. shared_secret_point = view_private * tx_out_public_key
///   2. hs = Blake2b512("mc_onetime_key_hash_to_scalar" || compress(shared_secret))
///   3. candidate_spend_pub = target_key - hs * G
///   4. Check candidate against known subaddress spend public keys
///   5. If match found: unmask amount, compute key image
#[wasm_bindgen]
pub fn scan_tx_out(
    tx_out_js: JsValue,
    view_private_key: &[u8],
    spend_private_key: &[u8],
    num_subaddresses: u64,
) -> Result<JsValue, JsError> {
    let tx_out: TxOutData = serde_wasm_bindgen::from_value(tx_out_js)?;

    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = spend_private_key.try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let b = scalar_from_canonical(&spend_bytes, "spend")?;

    // Decompress the TxOut public key (R)
    let tx_pub = decompress(&tx_out.public_key)?;

    // Step 1: shared secret point = a * R
    let shared_secret_point = a * tx_pub;
    let shared_secret_compressed = shared_secret_point.compress();

    // Step 2: hs = H_s(shared_secret)
    let hs = hash_to_scalar(HASH_TO_SCALAR_TAG, &shared_secret_compressed);

    // Step 3: candidate subaddress spend public key = P - hs * G
    let target = decompress(&tx_out.target_key)?;
    let candidate_d = target - hs * RISTRETTO_BASEPOINT_POINT;
    let candidate_d_compressed = candidate_d.compress();

    // Step 4: check against known subaddress spend public keys
    // We precompute D_i for each subaddress index and check
    let mut matched_index: Option<u64> = None;
    for i in 0..num_subaddresses {
        // subaddress spend public key:
        //   D_i = (Hs("mc_subaddress" || a || Scalar::from(i)) + b) * G
        // ALL indices use the same formula. Index serialized as Scalar (32 bytes).
        let mut hasher = Blake2b512::new();
        hasher.update(b"mc_subaddress");
        hasher.update(a.as_bytes());
        hasher.update(Scalar::from(i).as_bytes());
        let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher.finalize().into());
        let d_i = (hs_sub + b) * RISTRETTO_BASEPOINT_POINT;
        if d_i.compress() == candidate_d_compressed {
            matched_index = Some(i);
            break;
        }
    }

    if matched_index.is_none() {
        let result = ScanResult {
            owned: false,
            subaddress_index: None,
            value: None,
            token_id: None,
            key_image: None,
            global_index: tx_out.global_index,
            block_index: tx_out.block_index,
            memo: None,
        };
        return Ok(serde_wasm_bindgen::to_value(&result)?);
    }

    let subaddr_idx = matched_index.unwrap();

    // Step 5: unmask amount
    // If commitment is all zeros (from fog TxOutRecord without commitment data),
    // skip commitment verification — fog results are attested
    let skip_commitment_check = tx_out.commitment.iter().all(|&b| b == 0);
    let (value, token_id) = unmask_amount_v2(
        &shared_secret_compressed,
        tx_out.masked_value,
        &tx_out.masked_token_id,
        &tx_out.commitment,
        skip_commitment_check,
    )?;

    // Step 6: compute one-time private key and key image
    // d_i: subaddress spend private (same derivation as above)
    let mut hasher_ki = Blake2b512::new();
    hasher_ki.update(b"mc_subaddress");
    hasher_ki.update(a.as_bytes());
    hasher_ki.update(Scalar::from(subaddr_idx).as_bytes());
    let hs_ki = Scalar::from_bytes_mod_order_wide(&hasher_ki.finalize().into());
    let d_i = hs_ki + b;

    // onetime_private_key = hs + d_i
    let onetime_private = hs + d_i;

    // key_image = onetime_private * Hp(onetime_private * G)
    let onetime_public = (onetime_private * RISTRETTO_BASEPOINT_POINT).compress();
    let hp = hash_to_point(HASH_TO_POINT_TAG, onetime_public.as_bytes());
    let key_image = (onetime_private * hp).compress();

    // Step 7: decrypt memo (if present)
    let memo = decrypt_and_parse_memo(&tx_out.e_memo, &shared_secret_compressed);

    let result = ScanResult {
        owned: true,
        subaddress_index: Some(subaddr_idx),
        value: Some(value),
        token_id: Some(token_id),
        key_image: Some(key_image.as_bytes().to_vec()),
        global_index: tx_out.global_index,
        block_index: tx_out.block_index,
        memo,
    };

    Ok(serde_wasm_bindgen::to_value(&result)?)
}

/// Decrypt and parse a 66-byte encrypted memo.
///
/// Uses the same shared secret as amount unmasking:
///   memo_key = HKDF-SHA512(salt="mc-memo-okm", ikm=shared_secret)[..66]
///   plaintext = e_memo XOR memo_key
///
/// Then parses the 2-byte type prefix to extract structured fields.
fn decrypt_and_parse_memo(
    e_memo: &[u8],
    shared_secret: &CompressedRistretto,
) -> Option<DecodedMemo> {
    if e_memo.len() != MEMO_DATA_LEN {
        return None;
    }

    // Derive memo key
    let memo_hk = Hkdf::<Sha512>::new(Some(MEMO_KEY_SALT), shared_secret.as_bytes());
    let mut memo_key = [0u8; MEMO_DATA_LEN];
    if memo_hk.expand(b"", &mut memo_key).is_err() {
        return None;
    }

    // XOR decrypt
    let mut plaintext = [0u8; MEMO_DATA_LEN];
    for i in 0..MEMO_DATA_LEN {
        plaintext[i] = e_memo[i] ^ memo_key[i];
    }

    // Parse type prefix
    let memo_type = u16::from_be_bytes([plaintext[0], plaintext[1]]);

    // All zeros = unused memo
    if memo_type == 0x0000 && plaintext.iter().all(|&b| b == 0) {
        return None;
    }

    match memo_type {
        // 0x0100: AuthenticatedSenderMemo
        0x0100 => Some(DecodedMemo {
            memo_type,
            sender_address_hash: Some(plaintext[2..18].to_vec()),
            payment_request_id: None,
            destination_address_hash: None,
            total_outlay: None,
        }),
        // 0x0101: AuthenticatedSenderWithPaymentRequestMemo
        0x0101 => {
            let payment_request_id = u64::from_le_bytes(
                plaintext[18..26].try_into().unwrap()
            );
            Some(DecodedMemo {
                memo_type,
                sender_address_hash: Some(plaintext[2..18].to_vec()),
                payment_request_id: Some(payment_request_id),
                destination_address_hash: None,
                total_outlay: None,
            })
        },
        // 0x0200: DestinationMemo
        0x0200 => {
            let total_outlay = u64::from_le_bytes(
                plaintext[27..35].try_into().unwrap()
            );
            Some(DecodedMemo {
                memo_type,
                sender_address_hash: None,
                payment_request_id: None,
                destination_address_hash: Some(plaintext[2..18].to_vec()),
                total_outlay: Some(total_outlay),
            })
        },
        // Unknown type — return type only
        _ => Some(DecodedMemo {
            memo_type,
            sender_address_hash: None,
            payment_request_id: None,
            destination_address_hash: None,
            total_outlay: None,
        }),
    }
}

/// Unmask a MaskedAmountV2
///
/// 1. amount_shared_secret = Blake2b512("mc_amount_shared_secret" || compressed_point)[0..32]
/// 2. HKDF-SHA512 with salt "mc_amount_blinding_factors" and IKM = amount_shared_secret
/// 3. value_mask = HKDF-Expand(info="mc_amount_value", L=8)
/// 4. token_id_mask = HKDF-Expand(info="mc_amount_token_id", L=8)
/// 5. value = masked_value XOR value_mask, token_id = masked_token_id XOR token_id_mask
fn unmask_amount_v2(
    shared_secret: &CompressedRistretto,
    masked_value: u64,
    masked_token_id: &[u8],
    commitment_bytes: &[u8],
    skip_commitment_check: bool,
) -> Result<(u64, u64), JsError> {
    // Step 1: derive amount shared secret
    let mut hasher = Blake2b512::new();
    hasher.update(AMOUNT_SHARED_SECRET_TAG);
    hasher.update(shared_secret.as_bytes());
    let hash_result = hasher.finalize();
    let amount_shared_secret = &hash_result[..32];

    // Step 2: HKDF-SHA512
    let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);

    // Step 3: value mask
    let mut value_mask_bytes = [0u8; 8];
    hk.expand(AMOUNT_VALUE_INFO, &mut value_mask_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for value mask"))?;
    let value_mask = u64::from_le_bytes(value_mask_bytes);

    // Step 4: token_id mask
    let mut token_id_mask_bytes = [0u8; 8];
    hk.expand(AMOUNT_TOKEN_ID_INFO, &mut token_id_mask_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for token_id mask"))?;
    let token_id_mask = u64::from_le_bytes(token_id_mask_bytes);

    // Step 5: unmask
    let value = masked_value ^ value_mask;

    let mut tid_bytes = [0u8; 8];
    let copy_len = masked_token_id.len().min(8);
    tid_bytes[..copy_len].copy_from_slice(&masked_token_id[..copy_len]);
    let token_id = u64::from_le_bytes(tid_bytes) ^ token_id_mask;

    // Step 6: verify commitment (optional but recommended)
    // Derive blinding scalar
    let mut blinding_bytes = [0u8; 64];
    hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for blinding"))?;
    let blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

    // Compute token generator H_token
    let h_token = token_generator(token_id);

    // expected = value * H_token + blinding * G
    let expected = Scalar::from(value) * h_token + blinding * RISTRETTO_BASEPOINT_POINT;
    let expected_compressed = expected.compress();

    if !skip_commitment_check {
        let commitment = CompressedRistretto::from_slice(commitment_bytes)
            .map_err(|_| JsError::new("Invalid commitment length"))?;

        if expected_compressed != commitment {
            return Err(JsError::new("Amount commitment verification failed"));
        }
    }

    Ok((value, token_id))
}

/// Compute the Pedersen generator for a given token ID
/// H_token = RistrettoPoint::from_hash(Blake2b512("mc_onetime_key_hash_to_point" || (basepoint XOR token_id)))
fn token_generator(token_id: u64) -> RistrettoPoint {
    let mut base_bytes = RISTRETTO_BASEPOINT_POINT.compress().to_bytes();
    let tid_bytes = token_id.to_le_bytes();
    for i in 0..8 {
        base_bytes[i] ^= tid_bytes[i];
    }
    hash_to_point(HASH_TO_POINT_TAG, &base_bytes)
}

// ── KexRng Search Key Derivation (KexRng20201124) ──
//
// MobileCoin Fog uses KexRng to generate search keys for fog-view queries.
// The canonical algorithm (from fog/kex_rng/src/versioned/kexrng20201124.rs):
//
//   1. ECDH: shared_secret = view_private_key * rng_pubkey  (32 bytes)
//   2. PRF:  Blake2b512("20201124" || shared_secret || counter.to_le_bytes())
//   3. Take first 16 bytes of the 64-byte hash output as the search key
//
// Each RngRecord from fog-view has a pubkey and a start_block. The client
// generates search keys starting from the last synced counter and queries
// fog-view with them. VERSION_ID = 0.

/// KexRng output — a batch of search keys for fog-view queries
#[derive(Serialize, Deserialize)]
pub struct KexRngSearchKeys {
    pub search_keys: Vec<Vec<u8>>,  // each 16 bytes (KexRng20201124 output size)
    pub next_index: u64,            // next counter value for resuming
}

/// KexRng20201124 PRF: Blake2b512("20201124" || secret || counter) -> first 16 bytes
fn kex_rng_prf(secret: &[u8; 32], counter: u64) -> Vec<u8> {
    let mut hasher = Blake2b512::new();
    hasher.update(b"20201124");
    hasher.update(secret);
    hasher.update(counter.to_le_bytes());
    let result = hasher.finalize();
    result[..16].to_vec()
}

/// Derive KexRng search keys for a given RNG record.
///
/// Fog uses the DEFAULT SUBADDRESS view private key for KexRng, not the
/// account-level view key. The subaddress view private key is:
///   c = a * (Hs(a, 0) + b)
/// where a = view_private, b = spend_private, Hs = subaddress hash scalar.
///
/// Arguments:
///   - view_private_key: 32-byte account view private key scalar (a)
///   - spend_private_key: 32-byte account spend private key scalar (b)
///   - rng_pubkey: 32-byte compressed Ristretto pubkey from the RngRecord
///   - start_index: counter to start generating from (0 for fresh, resume from last)
///   - count: number of search keys to generate
///
/// Returns: KexRngSearchKeys with `count` 16-byte search keys and the next counter index
#[wasm_bindgen]
pub fn derive_kex_rng_search_keys(
    view_private_key: &[u8],
    spend_private_key: &[u8],
    rng_pubkey: &[u8],
    start_index: u64,
    count: u32,
) -> Result<JsValue, JsError> {
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let spend_bytes: [u8; 32] = spend_private_key.try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;
    let b = scalar_from_canonical(&spend_bytes, "spend")?;

    // Compute default subaddress view private key: c = a * (Hs(a, 0) + b)
    // Hs = Blake2b512("mc_subaddress" || a || Scalar::from(0))
    let index_scalar = Scalar::from(0u64);
    let mut hasher = Blake2b512::new();
    hasher.update(b"mc_subaddress");
    hasher.update(a.as_bytes());
    hasher.update(index_scalar.as_bytes());
    let hs_hash = hasher.finalize();
    let hs = Scalar::from_bytes_mod_order_wide(&hs_hash.into());
    let c = a * (hs + b);

    // Step 1: ECDH with the RNG pubkey using subaddress view private key
    let rng_point = decompress(rng_pubkey)?;
    let shared_secret = (c * rng_point).compress();
    let secret_bytes: [u8; 32] = shared_secret.to_bytes();

    // Step 2: Generate search keys using KexRng20201124 PRF
    let mut search_keys = Vec::with_capacity(count as usize);
    for i in 0..count as u64 {
        let counter = start_index + i;
        search_keys.push(kex_rng_prf(&secret_bytes, counter));
    }

    let result = KexRngSearchKeys {
        search_keys,
        next_index: start_index + count as u64,
    };

    Ok(serde_wasm_bindgen::to_value(&result)?)
}

/// Compute a key image for a known owned TxOut.
///
/// Given: view_private_key (a), spend_private_key (b), subaddress_index, tx_out_public_key (R), target_key (P)
/// Returns: 32-byte compressed Ristretto key image
#[wasm_bindgen]
pub fn compute_key_image(
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

    // shared secret scalar hs = H_s(a * R)
    let shared_secret = (a * tx_pub).compress();
    let hs = hash_to_scalar(HASH_TO_SCALAR_TAG, &shared_secret);

    // subaddress spend private key:
    //   d_i = Hs("mc_subaddress" || a || Scalar::from(i)) + b
    // ALL indices use the same formula. Index serialized as Scalar (32 bytes).
    let mut hasher = Blake2b512::new();
    hasher.update(b"mc_subaddress");
    hasher.update(a.as_bytes());
    hasher.update(Scalar::from(subaddress_index).as_bytes());
    let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher.finalize().into());
    let d_i = hs_sub + b;

    // onetime private key = hs + d_i
    let x = hs + d_i;

    // key_image = x * Hp(x * G)
    let onetime_pub = (x * RISTRETTO_BASEPOINT_POINT).compress();
    let hp = hash_to_point(HASH_TO_POINT_TAG, onetime_pub.as_bytes());
    let key_image = (x * hp).compress();

    Ok(key_image.as_bytes().to_vec())
}

// ── Fog CryptoBox Decryption (VersionedCryptoBox: Ristretto + HKDF-Blake2b512 + AES-256-GCM) ──
//
// MobileCoin's fog ingest encrypts TxOutRecords using VersionedCryptoBox:
//   - ECDH: Ristretto key exchange (ephemeral_pubkey * view_private_key)
//   - KDF:  HKDF-Blake2b512(salt="dei-salty-box", ikm=shared_secret, info="aead-key-iv") -> 44 bytes
//   - AEAD: AES-256-GCM(key=first 32, nonce=next 12, aad=empty)
//
// Ciphertext format (VersionedCryptoBox) — from mc-crypto-box/src/versioned.rs:
//   [encrypted_data | ephemeral_pubkey(32) | gcm_tag(16) | major(1) | minor(1)]
//   Total footer = 50 bytes (pubkey + tag + version).
//   Version bytes are the LAST 2 bytes of the ciphertext.
//
// IMPORTANT: FixedTxOutSearchResult zero-pads ciphertext to 255 bytes.
// The caller MUST truncate to the actual payload_length before calling this.

const CRYPTO_BOX_FOOTER_SIZE: usize = 50;  // pubkey(32) + tag(16) + version(2)
const CRYPTO_BOX_PUBKEY_SIZE: usize = 32;
const CRYPTO_BOX_TAG_SIZE: usize = 16;
const CRYPTO_BOX_SALT: &[u8] = b"dei-salty-box";
const CRYPTO_BOX_INFO: &[u8] = b"aead-key-iv";

/// Core decryption logic for fog VersionedCryptoBox (testable without wasm_bindgen)
fn decrypt_fog_ciphertext_inner(
    view_private_key: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, String> {
    if ciphertext.len() < CRYPTO_BOX_FOOTER_SIZE {
        return Err("Ciphertext too short for VersionedCryptoBox".into());
    }

    // Version bytes are the last 2 bytes (footer format per official MC source)
    let major = ciphertext[ciphertext.len() - 2];
    let minor = ciphertext[ciphertext.len() - 1];
    if major != 1 {
        return Err(format!("Unsupported CryptoBox major version: {}", major));
    }
    if minor != 0 {
        return Err(format!("Unsupported CryptoBox minor version: {}", minor));
    }

    // Split: [encrypted_data | pubkey(32) | tag(16) | major(1) | minor(1)]
    let data_len = ciphertext.len() - CRYPTO_BOX_FOOTER_SIZE;
    let inner_footer = &ciphertext[data_len..ciphertext.len() - 2]; // 48 bytes

    // Extract ephemeral public key and GCM tag from inner footer
    let ephemeral_pubkey_bytes = &inner_footer[..CRYPTO_BOX_PUBKEY_SIZE];
    let gcm_tag_bytes = &inner_footer[CRYPTO_BOX_PUBKEY_SIZE..CRYPTO_BOX_PUBKEY_SIZE + CRYPTO_BOX_TAG_SIZE];

    // Parse view private key as Ristretto scalar
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| "view key must be 32 bytes".to_string())?;
    let a = scalar_from_canonical(&view_bytes, "view")
        .map_err(|e| format!("{:?}", e))?;

    // Decompress ephemeral public key
    let compressed = CompressedRistretto::from_slice(ephemeral_pubkey_bytes)
        .map_err(|_| "Invalid ephemeral pubkey length".to_string())?;
    let ephemeral_pub = compressed.decompress()
        .ok_or_else(|| "Invalid ephemeral Ristretto point".to_string())?;

    // ECDH: shared_secret = view_private * ephemeral_pubkey
    let shared_secret = (a * ephemeral_pub).compress();

    // HKDF-Blake2b512: derive AES key (32 bytes) + nonce (12 bytes)
    let hkdf = SimpleHkdf::<Blake2b512>::new(Some(CRYPTO_BOX_SALT), shared_secret.as_bytes());
    let mut okm = [0u8; 44];
    hkdf.expand(CRYPTO_BOX_INFO, &mut okm)
        .map_err(|_| "HKDF expand failed".to_string())?;

    let aes_key = &okm[..32];
    let aes_nonce = &okm[32..44];

    // AES-256-GCM decrypt
    let cipher = Aes256Gcm::new_from_slice(aes_key)
        .map_err(|_| "Invalid AES key".to_string())?;

    let mut buffer = ciphertext[..data_len].to_vec();
    let nonce = Nonce::<Aes256Gcm>::from_slice(aes_nonce);
    let tag = Tag::<Aes256Gcm>::from_slice(gcm_tag_bytes);

    cipher.decrypt_in_place_detached(nonce, &[], &mut buffer, tag)
        .map_err(|_| "AES-GCM decryption failed".to_string())?;

    Ok(buffer)
}

/// WASM-exported wrapper for fog ciphertext decryption.
///
/// Fog encrypts TxOutRecords with the default subaddress view public key,
/// so we must decrypt with the default subaddress view private key:
///   c = a * (Hs(a, 0) + b)
#[wasm_bindgen]
pub fn decrypt_fog_ciphertext(
    view_private_key: &[u8],
    spend_private_key: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, JsError> {
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let spend_bytes: [u8; 32] = spend_private_key.try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;
    let b = scalar_from_canonical(&spend_bytes, "spend")?;

    // Compute default subaddress view private key: c = a * (Hs(a, 0) + b)
    let index_scalar = Scalar::from(0u64);
    let mut hasher = Blake2b512::new();
    hasher.update(b"mc_subaddress");
    hasher.update(a.as_bytes());
    hasher.update(index_scalar.as_bytes());
    let hs_hash = hasher.finalize();
    let hs = Scalar::from_bytes_mod_order_wide(&hs_hash.into());
    let c = a * (hs + b);

    decrypt_fog_ciphertext_inner(c.as_bytes(), ciphertext)
        .map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test vector from MobileCoin fog/kex_rng/src/lib.rs test_vectors:
    /// secret = ECDH(private_key_from([1u8;32]), pubkey_from([2u8;32]))
    /// The PRF outputs for counters 0..4 must match the canonical values.
    ///
    /// However, we can directly test the PRF function with a known secret.
    /// From kexrng20201124.rs: Blake2b512("20201124" || secret || counter.to_le_bytes())[..16]
    #[test]
    fn test_kex_rng_prf_deterministic() {
        let secret = [0xABu8; 32];
        let out0 = kex_rng_prf(&secret, 0);
        let out1 = kex_rng_prf(&secret, 1);

        assert_eq!(out0.len(), 16, "KexRng output must be 16 bytes");
        assert_eq!(out1.len(), 16, "KexRng output must be 16 bytes");
        assert_ne!(out0, out1, "Different counters must produce different outputs");

        // Same inputs must produce same output (deterministic)
        let out0_again = kex_rng_prf(&secret, 0);
        assert_eq!(out0, out0_again, "PRF must be deterministic");
    }

    #[test]
    fn test_kex_rng_prf_matches_tag() {
        // Verify the tag "20201124" is used correctly by checking against
        // a manual Blake2b512 computation
        let secret = [1u8; 32];
        let counter: u64 = 0;

        let mut hasher = Blake2b512::new();
        hasher.update(b"20201124");
        hasher.update(&secret);
        hasher.update(counter.to_le_bytes());
        let result = hasher.finalize();
        let expected: Vec<u8> = result[..16].to_vec();

        let actual = kex_rng_prf(&secret, counter);
        assert_eq!(actual, expected);
    }

    /// Round-trip test for fog CryptoBox: encrypt with view pubkey, decrypt with view privkey.
    /// Mirrors VersionedCryptoBox from MobileCoin crypto/box/src/versioned.rs
    #[test]
    fn test_fog_crypto_box_round_trip() {
        use aes_gcm::aead::AeadInPlace;

        // Use deterministic scalars for testing (not secure, just for test)
        let view_private = Scalar::from_bytes_mod_order([
            1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
            17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,0
        ]);
        let view_public = (view_private * RISTRETTO_BASEPOINT_POINT).compress();
        let view_private_bytes = view_private.as_bytes().to_vec();

        let eph_private = Scalar::from_bytes_mod_order([
            32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,
            48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,0
        ]);
        let eph_public = (eph_private * RISTRETTO_BASEPOINT_POINT).compress();

        // ECDH: shared_secret = eph_private * view_public
        let view_pub_point = view_public.decompress().unwrap();
        let shared_secret = (eph_private * view_pub_point).compress();

        // HKDF-Blake2b512
        let hkdf = SimpleHkdf::<Blake2b512>::new(Some(CRYPTO_BOX_SALT), shared_secret.as_bytes());
        let mut okm = [0u8; 44];
        hkdf.expand(CRYPTO_BOX_INFO, &mut okm).unwrap();
        let aes_key = &okm[..32];
        let aes_nonce_bytes = &okm[32..44];

        // Encrypt a test plaintext
        let plaintext = b"test TxOutRecord protobuf bytes here";
        let mut buffer = plaintext.to_vec();
        let cipher = Aes256Gcm::new_from_slice(aes_key).unwrap();
        let nonce = Nonce::<Aes256Gcm>::from_slice(aes_nonce_bytes);
        let tag = cipher.encrypt_in_place_detached(nonce, &[], &mut buffer).unwrap();

        // Build ciphertext in VersionedCryptoBox format:
        //   [encrypted_data] [ephemeral_pubkey(32)] [tag(16)] [major(1)] [minor(1)]
        let mut ciphertext = Vec::new();
        ciphertext.extend_from_slice(&buffer);
        ciphertext.extend_from_slice(eph_public.as_bytes());
        ciphertext.extend_from_slice(tag.as_slice());
        ciphertext.push(1); // major version
        ciphertext.push(0); // minor version

        // Decrypt using our function
        let decrypted = decrypt_fog_ciphertext_inner(&view_private_bytes, &ciphertext)
            .expect("decryption should succeed");
        assert_eq!(&decrypted, plaintext, "round-trip must recover original plaintext");

        // Test with wrong key fails
        let wrong_key = Scalar::from_bytes_mod_order([99u8; 32]);
        let result = decrypt_fog_ciphertext_inner(wrong_key.as_bytes(), &ciphertext);
        assert!(result.is_err(), "decryption with wrong key must fail");
    }
}

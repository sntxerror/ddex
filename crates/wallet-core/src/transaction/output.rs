//! TxOut construction, memo building, fog hint encryption.

use blake2::{Blake2b512, Digest};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::ristretto::CompressedRistretto;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use hkdf::Hkdf;
use sha2::Sha512;
use wasm_bindgen::prelude::*;

use super::{
    Recipient, BuiltTxOut,
    hash_to_scalar, decompress, random_scalar, token_generator,
    ONETIME_KEY_HASH_TO_SCALAR, AMOUNT_SHARED_SECRET_TAG, AMOUNT_BLINDING_SALT,
    AMOUNT_VALUE_INFO, AMOUNT_TOKEN_ID_INFO, AMOUNT_BLINDING_INFO,
    MEMO_KEY_SALT, MEMO_DATA_LEN, MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST,
    MEMO_TYPE_DESTINATION, SENDER_MEMO_CREDENTIAL_DOMAIN,
};

/// Size of the encrypted fog hint (VersionedCryptoBox output).
const ENCRYPTED_FOG_HINT_LEN: usize = 84;

/// Build the 66-byte AuthenticatedSenderWithPaymentRequestMemo (type 0x0101).
pub(crate) fn build_authenticated_sender_memo(
    sender_spend_private: &Scalar,
    sender_address_hash: &[u8; 16],
    recipient: &Recipient,
    payment_request_id: u64,
) -> Result<[u8; MEMO_DATA_LEN], JsError> {
    use hmac::{Hmac, Mac};

    let recipient_view_pub = decompress(&recipient.view_public_key)?;
    let recipient_spend_pub_bytes = &recipient.spend_public_key;

    let shared_secret = (*sender_spend_private * recipient_view_pub).compress();

    let mut hmac_key_mac = <Hmac<Sha512>>::new_from_slice(shared_secret.as_bytes())
        .map_err(|_| JsError::new("HMAC key derivation failed"))?;
    hmac_key_mac.update(SENDER_MEMO_CREDENTIAL_DOMAIN);
    let hmac_key = hmac_key_mac.finalize().into_bytes();

    let mut hmac = <Hmac<Sha512>>::new_from_slice(&hmac_key)
        .map_err(|_| JsError::new("HMAC computation failed"))?;
    hmac.update(recipient_spend_pub_bytes);
    let hmac_result = hmac.finalize().into_bytes();
    let hmac_bytes: [u8; 8] = hmac_result[..8].try_into().unwrap();

    let mut memo = [0u8; MEMO_DATA_LEN];
    memo[0..2].copy_from_slice(&MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST);
    memo[2..18].copy_from_slice(sender_address_hash);
    memo[18..26].copy_from_slice(&payment_request_id.to_le_bytes());
    // bytes 26..58 = padding (zeros)
    memo[58..66].copy_from_slice(&hmac_bytes);

    Ok(memo)
}

/// Build the 66-byte DestinationMemo (type 0x0200) for the change output.
pub(crate) fn build_destination_memo(
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
    memo
}

/// Compute a 16-byte address hash (short address hash for memos).
///
/// TODO: MC canonical ShortAddressHash uses Blake2b-256, not Blake2b-512.
/// Fix when adding cross-wallet memo interop.
pub(crate) fn compute_address_hash(view_public_key: &[u8], spend_public_key: &[u8]) -> [u8; 16] {
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

    let mut e_memo = vec![0u8; MEMO_DATA_LEN];
    for i in 0..MEMO_DATA_LEN {
        e_memo[i] = memo_plaintext[i] ^ memo_key[i];
    }
    Ok(e_memo)
}

/// Compute a confirmation number for a sent TxOut (HMAC-SHA256).
pub(crate) fn compute_confirmation_number(shared_secret: &CompressedRistretto, tx_out_public_key: &[u8]) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let mut mac = <Hmac<Sha256>>::new_from_slice(shared_secret.as_bytes())
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(tx_out_public_key);
    mac.finalize().into_bytes().to_vec()
}

/// Build a TxOut for a recipient.
///
/// MobileCoin subaddress protocol:
///   R = r * D_i   (tx_public_key)
///   shared_secret = r * C_i
///
/// `fog_hint_view_pub`: Override view key for fog hint (used for change outputs).
/// `memo_plaintext`: 66-byte memo payload to encrypt.
pub(crate) fn build_tx_out_inner(
    recipient: &Recipient,
    value: u64,
    token_id: u64,
    fog_ingest_pubkey: Option<&[u8]>,
    fog_hint_view_pub: Option<&[u8]>,
    memo_plaintext: Option<&[u8; MEMO_DATA_LEN]>,
) -> Result<(BuiltTxOut, CompressedRistretto), JsError> {
    let recipient_spend_pub = decompress(&recipient.spend_public_key)?;
    let recipient_view_pub = decompress(&recipient.view_public_key)?;

    let tx_private_key = random_scalar();
    let tx_public_key = (tx_private_key * recipient_spend_pub).compress();
    let shared_secret = (tx_private_key * recipient_view_pub).compress();

    // hs = H_s(shared_secret)
    let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());
    let target_key = (hs * RISTRETTO_BASEPOINT_POINT + recipient_spend_pub).compress();

    // Amount masking
    let mut amount_hasher = Blake2b512::new();
    amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
    amount_hasher.update(shared_secret.as_bytes());
    let amount_hash = amount_hasher.finalize();
    let amount_shared_secret = &amount_hash[..32];

    let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);

    let mut value_mask_bytes = [0u8; 8];
    hk.expand(AMOUNT_VALUE_INFO, &mut value_mask_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for value mask"))?;
    let masked_value = value ^ u64::from_le_bytes(value_mask_bytes);

    let mut token_id_mask_bytes = [0u8; 8];
    hk.expand(AMOUNT_TOKEN_ID_INFO, &mut token_id_mask_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for token_id mask"))?;
    let masked_token_id_val = token_id ^ u64::from_le_bytes(token_id_mask_bytes);

    let mut blinding_bytes = [0u8; 64];
    hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for blinding"))?;
    let blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

    // Pedersen commitment: value * H_token + blinding * G
    let h_token = token_generator(token_id);
    let commitment = (Scalar::from(value) * h_token + blinding * RISTRETTO_BASEPOINT_POINT).compress();

    // Fog hint
    let hint_view_pub = fog_hint_view_pub.unwrap_or(&recipient.view_public_key);
    let e_fog_hint = build_fog_hint(hint_view_pub, fog_ingest_pubkey)?;

    // Encrypted memo
    let e_memo = match memo_plaintext {
        Some(plaintext) => encrypt_memo(plaintext, &shared_secret)?,
        None => {
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

/// Build an encrypted fog hint using VersionedCryptoBox format (84 bytes).
fn build_fog_hint(
    recipient_view_pub: &[u8],
    fog_ingest_pubkey: Option<&[u8]>,
) -> Result<Vec<u8>, JsError> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::AeadInPlace};
    use hkdf::SimpleHkdf;

    let mut hint = vec![0u8; ENCRYPTED_FOG_HINT_LEN];

    match fog_ingest_pubkey {
        Some(ingest_key_bytes) => {
            let ingest_key = decompress(ingest_key_bytes)?;
            let ephemeral_private = random_scalar();
            let ephemeral_public = (ephemeral_private * RISTRETTO_BASEPOINT_POINT).compress();

            let shared = (ephemeral_private * ingest_key).compress();

            let hkdf = SimpleHkdf::<Blake2b512>::new(Some(b"dei-salty-box"), shared.as_bytes());
            let mut okm = [0u8; 44];
            hkdf.expand(b"aead-key-iv", &mut okm)
                .map_err(|_| JsError::new("HKDF failed for fog hint key"))?;
            let aes_key = &okm[..32];
            let aes_nonce = &okm[32..44];

            // Plaintext: recipient view public key (32 bytes) + 2-byte magic
            let mut buffer = vec![0u8; 34];
            buffer[..32].copy_from_slice(recipient_view_pub);
            buffer[32] = 42; // MAGIC_NUMBER
            buffer[33] = 42;

            let cipher = Aes256Gcm::new_from_slice(aes_key)
                .map_err(|_| JsError::new("AES key init failed"))?;
            let nonce = aes_gcm::Nonce::from_slice(aes_nonce);
            let tag = cipher.encrypt_in_place_detached(nonce, &[], &mut buffer)
                .map_err(|_| JsError::new("AES-GCM encrypt failed"))?;

            hint[0..34].copy_from_slice(&buffer);
            hint[34..66].copy_from_slice(ephemeral_public.as_bytes());
            hint[66..82].copy_from_slice(tag.as_slice());
            hint[82] = 1; // major version
            hint[83] = 0; // minor version
        }
        None => {
            getrandom::getrandom(&mut hint)
                .map_err(|e| JsError::new(&format!("RNG failed: {}", e)))?;
        }
    }

    Ok(hint)
}

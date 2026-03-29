use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use hkdf::Hkdf;
use sha2::Sha512;
use merlin::Transcript as MerlinTranscript;
use blake2::{Blake2b512, Digest};
use bip39::Mnemonic;
use crate::proto::encode_proto_bytes;
use rand_core::SeedableRng;
use rand_hc::Hc128Rng;
use schnorrkel_og::{
    context::attach_rng,
    SecretKey as SchnorrkelPrivate,
};

/// Account key pair derived from mnemonic
#[derive(Serialize, Deserialize, Clone)]
pub struct AccountKey {
    pub view_private_key: Vec<u8>,   // 32 bytes - Ristretto scalar
    pub spend_private_key: Vec<u8>,  // 32 bytes - Ristretto scalar
    pub fog_report_url: String,
    pub fog_authority_spki: Vec<u8>, // DER-encoded SubjectPublicKeyInfo
}

/// Public address for receiving payments (a subaddress)
#[derive(Serialize, Deserialize, Clone)]
pub struct PublicAddress {
    pub view_public_key: Vec<u8>,    // 32 bytes - compressed Ristretto point
    pub spend_public_key: Vec<u8>,   // 32 bytes - compressed Ristretto point
    pub fog_report_url: String,
    pub fog_authority_sig: Vec<u8>,  // Schnorrkel signature over SPKI
    pub subaddress_index: u64,
}

// Generate a cryptographically random 24-word BIP-39 mnemonic.
// Uses browser WebCrypto via the `getrandom/js` bridge package.
// More info https://crates.io/crates/getrandom
#[wasm_bindgen]
pub fn generate_mnemonic() -> Result<String, JsError> {
    let mut entropy = [0u8; 32];
    getrandom::getrandom(&mut entropy)
        .map_err(|e| JsError::new(&format!("RNG failed: {}", e)))?;
    let mnemonic = Mnemonic::from_entropy(&entropy)
        .map_err(|e| JsError::new(&format!("Mnemonic generation failed: {}", e)))?;
    Ok(mnemonic.to_string())
}

/// Validate a mnemonic phrase
#[wasm_bindgen]
pub fn validate_mnemonic(phrase: &str) -> bool {
    phrase.parse::<Mnemonic>().is_ok()
}

/// Derive an AccountKey from a mnemonic phrase.
///
/// Canonical derivation (matching Signal / MobileCoin SDK):
///   1. BIP39 mnemonic -> seed (empty passphrase)
///   2. SLIP-0010 at m/44'/866'/0' -> 32-byte Slip10Key
///   3. Spend: HKDF-SHA512(salt="mobilecoin-ristretto255-spend", ikm=slip10key) -> 64 bytes -> Scalar
///   4. View:  HKDF-SHA512(salt="mobilecoin-ristretto255-view",  ikm=slip10key) -> 64 bytes -> Scalar
///
/// Source: mobilecoinfoundation/mobilecoin core/src/slip10/mod.rs
#[wasm_bindgen]
pub fn mnemonic_to_account_key(phrase: &str, fog_report_url: &str, fog_authority_spki: &[u8]) -> Result<JsValue, JsError> {
    let mnemonic: Mnemonic = phrase.parse()
        .map_err(|e| JsError::new(&format!("Invalid mnemonic: {}", e)))?;

    let seed = mnemonic.to_seed("");

    // SLIP-0010 derivation for Ed25519
    // Path: m/44'/866'/0' (866 = MobileCoin's registered coin type)
    let slip10_key = slip10_ed25519::derive_ed25519_private_key(&seed, &[
        44 | 0x80000000,   // purpose (hardened)
        866 | 0x80000000,  // coin type: MobileCoin (hardened)
        0 | 0x80000000,    // account 0 (hardened)
    ]);

    // Derive spend private key via HKDF-SHA512
    // Salt = "mobilecoin-ristretto255-spend", IKM = slip10_key, info = ""
    let spend_hkdf = Hkdf::<Sha512>::new(Some(b"mobilecoin-ristretto255-spend"), &slip10_key);
    let mut spend_okm = [0u8; 64];
    spend_hkdf.expand(b"", &mut spend_okm)
        .map_err(|_| JsError::new("HKDF expand failed for spend key"))?;
    let spend_scalar = Scalar::from_bytes_mod_order_wide(&spend_okm);

    // Derive view private key via HKDF-SHA512
    // Salt = "mobilecoin-ristretto255-view", IKM = slip10_key, info = ""
    let view_hkdf = Hkdf::<Sha512>::new(Some(b"mobilecoin-ristretto255-view"), &slip10_key);
    let mut view_okm = [0u8; 64];
    view_hkdf.expand(b"", &mut view_okm)
        .map_err(|_| JsError::new("HKDF expand failed for view key"))?;
    let view_scalar = Scalar::from_bytes_mod_order_wide(&view_okm);

    let account_key = AccountKey {
        view_private_key: view_scalar.as_bytes().to_vec(),
        spend_private_key: spend_scalar.as_bytes().to_vec(),
        fog_report_url: fog_report_url.to_string(),
        fog_authority_spki: fog_authority_spki.to_vec(),
    };

    Ok(serde_wasm_bindgen::to_value(&account_key)?)
}

/// Convert 32 bytes to a Scalar, returning JsError on non-canonical input
pub(crate) fn scalar_from_canonical(bytes: &[u8; 32], name: &str) -> Result<Scalar, JsError> {
    let ct = Scalar::from_canonical_bytes(*bytes);
    if bool::from(ct.is_some()) {
        Ok(ct.unwrap())
    } else {
        Err(JsError::new(&format!("Invalid {} private key scalar", name)))
    }
}

/// Schnorrkel signing matching MobileCoin's `sign_authority` implementation.
/// Context: b"Fog authority signature", message: SPKI bytes.
/// Uses deterministic nonce via Merlin transcript (same as mc-crypto-keys).
fn sign_schnorrkel_authority(private_scalar: &Scalar, spki_bytes: &[u8]) -> Vec<u8> {
    let context = b"Fog authority signature";
    let private_bytes = private_scalar.as_bytes();

    // Deterministic nonce via Merlin transcript
    let nonce = {
        let mut transcript = MerlinTranscript::new(b"SigningNonce");
        transcript.append_message(b"context", context);
        transcript.append_message(b"private", private_bytes);
        transcript.append_message(b"message", spki_bytes);
        let mut nonce = [0u8; 32];
        transcript.challenge_bytes(b"nonce", &mut nonce);
        nonce
    };

    // Construct Schnorrkel SecretKey: [32 scalar bytes | 32 nonce bytes]
    let mut secret_bytes = [0u8; 64];
    secret_bytes[0..32].copy_from_slice(private_bytes);
    secret_bytes[32..64].copy_from_slice(&nonce);
    let secret_key = SchnorrkelPrivate::from_bytes(&secret_bytes).unwrap();
    let keypair = secret_key.to_keypair();

    // SigningContext provides domain separation
    let mut t = MerlinTranscript::new(b"SigningContext");
    t.append_message(b"", context);
    t.append_message(b"sign-bytes", spki_bytes);

    let csprng = Hc128Rng::from_seed(nonce);
    let transcript = attach_rng(t, csprng);
    let sig = keypair.sign(transcript);

    sig.to_bytes().to_vec()
}

/// Derive a subaddress (PublicAddress) from an AccountKey at a given index
///
/// Subaddress derivation (CryptoNote-style):
///   Hs = Scalar::from(Blake2b512("mc_subaddress" || view_private_key || index_bytes))
///   subaddress_spend_public = (Hs + spend_private) * G
///   subaddress_view_public  = view_private * subaddress_spend_public
#[wasm_bindgen]
pub fn derive_subaddress(account_key_js: JsValue, index: u64) -> Result<JsValue, JsError> {
    let account_key: AccountKey = serde_wasm_bindgen::from_value(account_key_js)?;

    let view_bytes: [u8; 32] = account_key.view_private_key.as_slice().try_into()
        .map_err(|_| JsError::new("Invalid view key length"))?;
    let view_private = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = account_key.spend_private_key.as_slice().try_into()
        .map_err(|_| JsError::new("Invalid spend key length"))?;
    let spend_private = scalar_from_canonical(&spend_bytes, "spend")?;

    // Derive subaddress spend private key:
    //   d_i = Hs("mc_subaddress" || a || Scalar::from(i).as_bytes()) + b
    // ALL indices including 0 use the same formula — NO special case.
    // Index is serialized as Scalar (32 bytes), NOT u64 LE (8 bytes).
    // Reference: mc-core/src/subaddress.rs
    let mut hasher = Blake2b512::new();
    hasher.update(b"mc_subaddress");
    hasher.update(view_private.as_bytes());
    hasher.update(Scalar::from(index).as_bytes()); // 32-byte Scalar encoding
    let hs_hash = hasher.finalize();
    let hs = Scalar::from_bytes_mod_order_wide(&hs_hash.into());
    let subaddress_spend_private = hs + spend_private;
    // subaddress_spend_public = subaddress_spend_private * G
    let subaddress_spend_public = subaddress_spend_private * RISTRETTO_BASEPOINT_POINT;

    // subaddress_view_public = a * subaddress_spend_public
    let subaddress_view_public = view_private * subaddress_spend_public;

    // Compute fog_authority_sig: Schnorrkel sign(subaddress_view_private, SPKI)
    // subaddress_view_private = a * (Hs + b) where a=view_private, b=spend_private
    let fog_authority_sig = if !account_key.fog_report_url.is_empty() && !account_key.fog_authority_spki.is_empty() {
        let subaddress_view_scalar = view_private * (hs + spend_private);
        sign_schnorrkel_authority(&subaddress_view_scalar, &account_key.fog_authority_spki)
    } else {
        Vec::new()
    };

    let public_address = PublicAddress {
        view_public_key: subaddress_view_public.compress().as_bytes().to_vec(),
        spend_public_key: subaddress_spend_public.compress().as_bytes().to_vec(),
        fog_report_url: account_key.fog_report_url.clone(),
        fog_authority_sig,
        subaddress_index: index,
    };

    Ok(serde_wasm_bindgen::to_value(&public_address)?)
}

/// Wrap a 32-byte key in CompressedRistretto protobuf: { bytes data = 1 }
fn wrap_compressed_ristretto(key: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(key.len() + 4);
    encode_proto_bytes(&mut out, 1, key);
    out
}

/// Get the default receive address as a MobileCoin b58-encoded string.
///
/// Encoding: PrintableWrapper protobuf → CRC32-ISO-HDLC → prepend 4-byte LE checksum → bs58
#[wasm_bindgen]
pub fn get_b58_address(account_key_js: JsValue) -> Result<String, JsError> {
    let address_js = derive_subaddress(account_key_js, 0)?;
    let address: PublicAddress = serde_wasm_bindgen::from_value(address_js)?;

    // Build PublicAddress protobuf (mc-api external.proto)
    let mut addr_bytes = Vec::with_capacity(256);
    // field 1: view_public_key (CompressedRistretto { bytes data = 1 })
    encode_proto_bytes(&mut addr_bytes, 1, &wrap_compressed_ristretto(&address.view_public_key));
    // field 2: spend_public_key
    encode_proto_bytes(&mut addr_bytes, 2, &wrap_compressed_ristretto(&address.spend_public_key));
    // field 3: fog_report_url (string)
    if !address.fog_report_url.is_empty() {
        encode_proto_bytes(&mut addr_bytes, 3, address.fog_report_url.as_bytes());
    }
    // field 4: fog_report_id (string) — empty for Signal mainnet
    // field 5: fog_authority_sig (bytes)
    if !address.fog_authority_sig.is_empty() {
        encode_proto_bytes(&mut addr_bytes, 5, &address.fog_authority_sig);
    }

    // Wrap in PrintableWrapper { PublicAddress public_address = 1 }
    let mut wrapper = Vec::with_capacity(addr_bytes.len() + 10);
    encode_proto_bytes(&mut wrapper, 1, &addr_bytes);

    // CRC32 (ISO-HDLC / CRC-32C)
    let checksum = crc32fast::hash(&wrapper);
    let mut payload = Vec::with_capacity(4 + wrapper.len());
    payload.extend_from_slice(&checksum.to_le_bytes());
    payload.extend_from_slice(&wrapper);

    Ok(bs58::encode(payload).with_alphabet(bs58::Alphabet::BITCOIN).into_string())
}

/// Decode and validate a MobileCoin B58-encoded public address.
///
/// Returns a Recipient-compatible object:
///   { view_public_key: [u8;32], spend_public_key: [u8;32], fog_report_url: String }
///
/// Rejects invalid checksums, malformed protobuf, or missing key fields.
#[wasm_bindgen]
pub fn decode_b58_address(b58_string: &str) -> Result<JsValue, JsError> {
    let payload = bs58::decode(b58_string)
        .with_alphabet(bs58::Alphabet::BITCOIN)
        .into_vec()
        .map_err(|e| JsError::new(&format!("Invalid base58: {}", e)))?;

    if payload.len() < 5 {
        return Err(JsError::new("Address too short"));
    }

    let stored_checksum = u32::from_le_bytes(
        payload[..4].try_into().map_err(|_| JsError::new("Checksum read error"))?
    );
    let wrapper_bytes = &payload[4..];
    let computed_checksum = crc32fast::hash(wrapper_bytes);

    if stored_checksum != computed_checksum {
        return Err(JsError::new("Invalid checksum — address may be corrupted"));
    }

    // Parse PrintableWrapper { PublicAddress public_address = 1 }
    let addr_bytes = parse_submessage(wrapper_bytes, 1)?;

    // Parse PublicAddress fields
    let view_key_msg = parse_submessage(&addr_bytes, 1)?;
    let view_public_key = parse_bytes_field(&view_key_msg, 1)?;

    let spend_key_msg = parse_submessage(&addr_bytes, 2)?;
    let spend_public_key = parse_bytes_field(&spend_key_msg, 1)?;

    if view_public_key.len() != 32 {
        return Err(JsError::new(&format!("view_public_key must be 32 bytes, got {}", view_public_key.len())));
    }
    if spend_public_key.len() != 32 {
        return Err(JsError::new(&format!("spend_public_key must be 32 bytes, got {}", spend_public_key.len())));
    }

    // fog_report_url (field 3, optional string)
    let fog_report_url = match parse_bytes_field_opt(&addr_bytes, 3) {
        Some(bytes) => String::from_utf8(bytes).unwrap_or_default(),
        None => String::new(),
    };

    #[derive(Serialize)]
    struct DecodedAddress {
        view_public_key: Vec<u8>,
        spend_public_key: Vec<u8>,
        fog_report_url: String,
    }

    Ok(serde_wasm_bindgen::to_value(&DecodedAddress {
        view_public_key,
        spend_public_key,
        fog_report_url,
    })?)
}

// ── Minimal protobuf field parsers for decode_b58_address ──

/// Extract a length-delimited submessage for a given field number.
fn parse_submessage(buf: &[u8], target_field: u32) -> Result<Vec<u8>, JsError> {
    let mut pos = 0;
    while pos < buf.len() {
        let (tag, new_pos) = read_varint_u64(buf, pos)?;
        pos = new_pos;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 7) as u32;

        match wire_type {
            0 => { let (_, p) = read_varint_u64(buf, pos)?; pos = p; }
            1 => { pos += 8; }
            5 => { pos += 4; }
            2 => {
                let (len, p) = read_varint_u64(buf, pos)?;
                pos = p;
                let len = len as usize;
                if field_number == target_field {
                    return Ok(buf[pos..pos + len].to_vec());
                }
                pos += len;
            }
            _ => return Err(JsError::new(&format!("Unknown wire type {}", wire_type))),
        }
    }
    Err(JsError::new(&format!("Field {} not found", target_field)))
}

/// Extract a bytes field (optional version — returns None if not found).
fn parse_bytes_field_opt(buf: &[u8], target_field: u32) -> Option<Vec<u8>> {
    parse_submessage(buf, target_field).ok()
}

/// Extract a bytes field (required version — returns error if not found).
fn parse_bytes_field(buf: &[u8], target_field: u32) -> Result<Vec<u8>, JsError> {
    parse_submessage(buf, target_field)
}

fn read_varint_u64(buf: &[u8], pos: usize) -> Result<(u64, usize), JsError> {
    let mut result: u64 = 0;
    let mut shift = 0;
    let mut p = pos;
    while p < buf.len() {
        let byte = buf[p] as u64;
        result |= (byte & 0x7f) << shift;
        p += 1;
        if byte & 0x80 == 0 { return Ok((result, p)); }
        shift += 7;
        if shift >= 64 { return Err(JsError::new("Varint overflow")); }
    }
    Err(JsError::new("Truncated varint"))
}

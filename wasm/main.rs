use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use hkdf::Hkdf;
use sha2::Sha512;
use merlin::Transcript as MerlinTranscript;
use blake2::{Blake2b512, Digest};
use bip39::Mnemonic;
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

fn main() {
    let mnemonic = generate_mnemonic().unwrap_or("".to_string());
    println!("{}", mnemonic)
}

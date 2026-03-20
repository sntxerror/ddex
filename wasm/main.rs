use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use curve25519_dalek::scalar::Scalar;
use hkdf::Hkdf;
use sha2::Sha512;
use bip39::{Language, Mnemonic};

/// Account key pair derived from mnemonic
#[derive(Serialize, Deserialize, Clone)]
pub struct AccountKey {
    pub view_private_key: Vec<u8>,   // 32 bytes - Ristretto scalar
    pub spend_private_key: Vec<u8>,  // 32 bytes - Ristretto scalar
    pub fog_report_url: String,
    pub fog_authority_spki: Vec<u8>, // DER-encoded SubjectPublicKeyInfo
}

fn to_js_err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

// Generate a cryptographically random 24-word BIP-39 mnemonic.
// Uses browser WebCrypto via the `getrandom/js` bridge package.
// More info https://crates.io/crates/getrandom
#[wasm_bindgen]
pub fn generate_mnemonic() -> Result<String, JsValue> {
    let mut entropy = [0u8; 32]; // 32 bytes = 24 words

    // In JS context should be the same as browser crypto.getRandomValues()
    getrandom::fill(&mut entropy)
        .map_err(to_js_err)?;

    let m = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(to_js_err)?;

    Ok(m.to_string())
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

// TODO (kif): Make public keys using derive_subaddress

fn main() {
    let mnemonic = generate_mnemonic().unwrap();
    println!("{}", mnemonic)
}

use wasm_bindgen::prelude::*;
use js_sys::Math;

// ── Phase 0 crypto imports ────────────────────────────────────────────────────
use bip39::{Language, Mnemonic};
use curve25519_dalek::{constants::RISTRETTO_BASEPOINT_POINT, scalar::Scalar};
use hmac::{Hmac, Mac};
use hkdf::Hkdf;
use sha2::{Digest, Sha256, Sha512};

type HmacSha512 = Hmac<Sha512>;

// ── Module bootstrap ─────────────────────────────────────────────────────────

/// Initialize the wallet core module.
#[wasm_bindgen]
pub fn init() -> String {
    "wallet-core WASM module loaded successfully".to_string()
}

/// Returns the current version of the wallet core.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── BIP-39 mnemonic ───────────────────────────────────────────────────────────

/// Generate a cryptographically random 24-word BIP-39 mnemonic.
/// Uses browser WebCrypto via the `getrandom/js` bridge.
#[wasm_bindgen]
pub fn generate_mnemonic() -> Result<String, JsValue> {
    let m = Mnemonic::generate_in(Language::English, 24)
        .map_err(|e| JsValue::from_str(&format!("mnemonic generation failed: {e}")))?;
    Ok(m.to_string())
}

/// Returns true if `phrase` is a valid BIP-39 English mnemonic.
#[wasm_bindgen]
pub fn validate_mnemonic(phrase: &str) -> bool {
    Mnemonic::parse_in(Language::English, phrase).is_ok()
}

// ── Key derivation (Phase 0 manual implementation) ───────────────────────────
//
// Algorithm used here (subject to validation once mc-account-keys compiles
// to WASM, see Cargo.toml feature "mc-keys"):
//
//   1. BIP-39 mnemonic → raw entropy bytes (32 bytes for 24 words)
//   2. SLIP-0010 master key derivation:
//        HMAC-SHA512(key = "ed25519 seed", data = entropy)
//        → master_key (first 32 bytes)
//   3. HKDF-SHA256 expand from master_key:
//        view_private  = HKDF(master_key, info = b"mc-view-key-0")
//        spend_private = HKDF(master_key, info = b"mc-spend-key-0")
//   4. Reduce each 32-byte value mod the Ristretto255 scalar order.
//   5. Compute Ristretto255 public keys: private * G
//   6. Concatenate the two 32-byte compressed public keys (64 bytes total).
//   7. Prepend a 1-byte version tag (0x03 = MobileCoin simplified address).
//   8. Append a 4-byte SHA-256d checksum.
//   9. Base-58 encode the result.
//
// NOTE: Step 3 and the exact derivation path may differ from official
// mc-account-keys. Deliverable #3 ("address matches official tooling") is
// pending the mc-keys feature build test. See docs/phase0-findings.md.

/// Returns a JSON object { view_pub_hex, spend_pub_hex, address_b58 }
/// or throws a JS error string on invalid mnemonic.
#[wasm_bindgen]
pub fn derive_address(phrase: &str) -> Result<String, JsValue> {
    let mnemonic = Mnemonic::parse_in(Language::English, phrase)
        .map_err(|e| JsValue::from_str(&format!("invalid mnemonic: {e}")))?;

    // Step 1 – raw entropy from the mnemonic (32 bytes for 24 words)
    let entropy: Vec<u8> = mnemonic.to_entropy();

    // Step 2 – SLIP-0010 master key
    let mut mac = HmacSha512::new_from_slice(b"ed25519 seed")
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    mac.update(&entropy);
    let slip10 = mac.finalize().into_bytes();
    let master_key: [u8; 32] = slip10[..32].try_into().unwrap();

    // Step 3 – HKDF to derive two independent 32-byte private scalars
    let hk = Hkdf::<Sha256>::new(None, &master_key);
    let mut view_bytes  = [0u8; 32];
    let mut spend_bytes = [0u8; 32];
    hk.expand(b"mc-view-key-0",  &mut view_bytes)
        .map_err(|_| JsValue::from_str("HKDF expand failed for view key"))?;
    hk.expand(b"mc-spend-key-0", &mut spend_bytes)
        .map_err(|_| JsValue::from_str("HKDF expand failed for spend key"))?;

    // Step 4 – reduce mod Ristretto255 scalar order
    let view_scalar  = Scalar::from_bytes_mod_order(view_bytes);
    let spend_scalar = Scalar::from_bytes_mod_order(spend_bytes);

    // Step 5 – compute public keys
    let view_pub  = (RISTRETTO_BASEPOINT_POINT * view_scalar).compress();
    let spend_pub = (RISTRETTO_BASEPOINT_POINT * spend_scalar).compress();

    // Step 6-9 – build address bytes and Base-58 encode
    let mut payload = Vec::with_capacity(1 + 64 + 4);
    payload.push(0x03u8); // version byte
    payload.extend_from_slice(view_pub.as_bytes());
    payload.extend_from_slice(spend_pub.as_bytes());

    // 4-byte double-SHA256 checksum
    let hash1 = Sha256::digest(&payload);
    let hash2 = Sha256::digest(&hash1);
    payload.extend_from_slice(&hash2[..4]);

    let address_b58 = bs58::encode(&payload).into_string();

    // Produce a JSON result
    let result = format!(
        r#"{{"view_pub":"{view}","spend_pub":"{spend}","address_b58":"{addr}","note":"derivation path differs from mc-account-keys until mc-keys feature is validated"}}"#,
        view  = hex::encode(view_pub.as_bytes()),
        spend = hex::encode(spend_pub.as_bytes()),
        addr  = address_b58,
    );
    Ok(result)
}

// ---- Game of Life (canonical Rust WASM demo) ----
// Based on: https://github.com/nicholasray/wasm-game-of-life
//   (from the official Rust and WebAssembly book)

#[wasm_bindgen]
pub struct Universe {
    width: u32,
    height: u32,
    cells: Vec<u8>,
}

#[wasm_bindgen]
impl Universe {
    pub fn new(width: u32, height: u32) -> Universe {
        let cells = (0..width * height)
            .map(|_| if Math::random() < 0.25 { 1 } else { 0 })
            .collect();
        Universe { width, height, cells }
    }

    /// Re-seed with a fresh random state.
    pub fn reset(&mut self) {
        self.cells = (0..self.width * self.height)
            .map(|_| if Math::random() < 0.25 { 1 } else { 0 })
            .collect();
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn cells_ptr(&self) -> *const u8 {
        self.cells.as_ptr()
    }

    /// Spawn live cells in a radius around (col, row).
    pub fn spawn(&mut self, col: i32, row: i32, radius: i32) {
        for dr in -radius..=radius {
            for dc in -radius..=radius {
                if dr * dr + dc * dc > radius * radius { continue; }
                if Math::random() > 0.6 { continue; }
                let r = ((row + dr).rem_euclid(self.height as i32)) as u32;
                let c = ((col + dc).rem_euclid(self.width as i32)) as u32;
                let idx = (r * self.width + c) as usize;
                self.cells[idx] = 1;
            }
        }
    }

    pub fn tick(&mut self) {
        let mut next = self.cells.clone();
        for row in 0..self.height {
            for col in 0..self.width {
                let idx = (row * self.width + col) as usize;
                let cell = self.cells[idx];
                let live_neighbors = self.live_neighbor_count(row, col);
                next[idx] = match (cell, live_neighbors) {
                    (1, x) if x < 2 => 0,
                    (1, 2) | (1, 3) => 1,
                    (1, x) if x > 3 => 0,
                    (0, 3) => 1,
                    (c, _) => c,
                };
            }
        }
        self.cells = next;
    }

    fn live_neighbor_count(&self, row: u32, col: u32) -> u8 {
        let mut count = 0;
        for dr in [self.height - 1, 0, 1] {
            for dc in [self.width - 1, 0, 1] {
                if dr == 0 && dc == 0 { continue; }
                let r = (row + dr) % self.height;
                let c = (col + dc) % self.width;
                count += self.cells[(r * self.width + c) as usize];
            }
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_universe(w: u32, h: u32) -> Universe {
        Universe {
            width: w,
            height: h,
            cells: vec![0; (w * h) as usize],
        }
    }

    #[test]
    fn test_init() {
        assert!(init().contains("loaded successfully"));
    }

    #[test]
    fn test_version() {
        assert_eq!(version(), "0.1.0");
    }

    #[test]
    fn test_validate_mnemonic_invalid() {
        assert!(!validate_mnemonic("not a valid mnemonic phrase at all"));
    }

    #[test]
    fn test_derive_address_invalid_mnemonic() {
        assert!(derive_address("bad phrase").is_err());
    }

    #[test]
    fn test_derive_address_valid_mnemonic() {
        // 24-word test vector (BIP-39 standard test mnemonic)
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon abandon \
                      abandon abandon abandon abandon abandon abandon abandon art";
        let result = derive_address(phrase).expect("derivation should succeed");
        // Must be valid JSON containing address_b58
        assert!(result.contains("address_b58"));
        assert!(result.contains("view_pub"));
        assert!(result.contains("spend_pub"));
    }

    #[test]
    fn test_universe_creation() {
        let u = make_universe(64, 64);
        assert_eq!(u.width(), 64);
        assert_eq!(u.height(), 64);
    }

    #[test]
    fn test_universe_tick() {
        let mut u = make_universe(10, 10);
        u.tick();
        assert_eq!(u.width(), 10);
    }
}

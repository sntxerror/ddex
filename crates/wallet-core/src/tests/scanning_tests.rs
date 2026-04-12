use aes_gcm::{
    aead::{AeadInPlace, Nonce},
    Aes256Gcm, KeyInit,
};
use blake2::{Blake2b512, Digest};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::scalar::Scalar;
use hkdf::SimpleHkdf;

use crate::scanning::{
    decrypt_fog_ciphertext_inner, kex_rng_prf, CRYPTO_BOX_INFO, CRYPTO_BOX_SALT,
};

#[test]
fn test_kex_rng_prf_deterministic() {
    let secret = [0xABu8; 32];
    let out0 = kex_rng_prf(&secret, 0);
    let out1 = kex_rng_prf(&secret, 1);

    assert_eq!(out0.len(), 16, "KexRng output must be 16 bytes");
    assert_eq!(out1.len(), 16, "KexRng output must be 16 bytes");
    assert_ne!(
        out0, out1,
        "Different counters must produce different outputs"
    );

    let out0_again = kex_rng_prf(&secret, 0);
    assert_eq!(out0, out0_again, "PRF must be deterministic");
}

#[test]
fn test_kex_rng_prf_matches_tag() {
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

#[test]
fn test_fog_crypto_box_round_trip() {
    let view_private = Scalar::from_bytes_mod_order([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 0,
    ]);
    let view_public = (view_private * RISTRETTO_BASEPOINT_POINT).compress();
    let view_private_bytes = view_private.as_bytes().to_vec();

    let eph_private = Scalar::from_bytes_mod_order([
        32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
        55, 56, 57, 58, 59, 60, 61, 62, 0,
    ]);
    let eph_public = (eph_private * RISTRETTO_BASEPOINT_POINT).compress();

    let view_pub_point = view_public.decompress().unwrap();
    let shared_secret = (eph_private * view_pub_point).compress();

    let hkdf = SimpleHkdf::<Blake2b512>::new(Some(CRYPTO_BOX_SALT), shared_secret.as_bytes());
    let mut okm = [0u8; 44];
    hkdf.expand(CRYPTO_BOX_INFO, &mut okm).unwrap();
    let aes_key = &okm[..32];
    let aes_nonce_bytes = &okm[32..44];

    let plaintext = b"test TxOutRecord protobuf bytes here";
    let mut buffer = plaintext.to_vec();
    let cipher = Aes256Gcm::new_from_slice(aes_key).unwrap();
    let nonce = Nonce::<Aes256Gcm>::from_slice(aes_nonce_bytes);
    let tag = cipher
        .encrypt_in_place_detached(nonce, &[], &mut buffer)
        .unwrap();

    let mut ciphertext = Vec::new();
    ciphertext.extend_from_slice(&buffer);
    ciphertext.extend_from_slice(eph_public.as_bytes());
    ciphertext.extend_from_slice(tag.as_slice());
    ciphertext.push(1);
    ciphertext.push(0);

    let decrypted = decrypt_fog_ciphertext_inner(&view_private_bytes, &ciphertext)
        .expect("decryption should succeed");
    assert_eq!(
        &decrypted, plaintext,
        "round-trip must recover original plaintext"
    );

    let wrong_key = Scalar::from_bytes_mod_order([99u8; 32]);
    let result = decrypt_fog_ciphertext_inner(wrong_key.as_bytes(), &ciphertext);
    assert!(result.is_err(), "decryption with wrong key must fail");
}

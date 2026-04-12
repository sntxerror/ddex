//! MLSAG ring signatures for sender anonymity.

use blake2::{Blake2b512, Digest};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::ristretto::CompressedRistretto;
use curve25519_dalek::scalar::Scalar;
use wasm_bindgen::prelude::*;

use super::{
    decompress, hash_to_point, random_scalar, token_generator, RingMLSAG, RingMember,
    MLSAG_CHALLENGE_TAG, ONETIME_KEY_HASH_TO_POINT,
};

/// Sign a single input ring with MLSAG.
pub(super) fn sign_mlsag(
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
    let z = *pseudo_output_blinding - *blinding;

    let h_token = token_generator(token_id);
    let pseudo_output = (Scalar::from(value) * h_token
        + *pseudo_output_blinding * RISTRETTO_BASEPOINT_POINT)
        .compress();

    let p_pi = CompressedRistretto::from_slice(&ring[real_index].target_key)
        .map_err(|_| JsError::new("Invalid target key in ring"))?;

    // Self-verification: onetime private key must match target_key
    let computed_pubkey = (x * RISTRETTO_BASEPOINT_POINT).compress();
    if computed_pubkey != p_pi {
        let expected_hex: String = p_pi
            .as_bytes()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect();
        let got_hex: String = computed_pubkey
            .as_bytes()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect();
        let x_hex: String = x.as_bytes().iter().map(|b| format!("{:02x}", b)).collect();
        let ring_pk_hex: String = ring[real_index]
            .public_key
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect();
        return Err(JsError::new(&format!(
            "MLSAG self-check FAILED: x*G != target_key. target={} xG={} x={} ring_pk={} real_idx={}",
            expected_hex, got_hex, x_hex, ring_pk_hex, real_index
        )));
    }

    // Self-verification: commitment balance
    let real_commitment = decompress(&ring[real_index].commitment)?;
    let expected_z_point = pseudo_output
        .decompress()
        .ok_or_else(|| JsError::new("Invalid pseudo output for self-check"))?
        - real_commitment;
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

    let mut ring_target_keys: Vec<curve25519_dalek::ristretto::RistrettoPoint> =
        Vec::with_capacity(ring_size);
    let mut ring_commitments: Vec<curve25519_dalek::ristretto::RistrettoPoint> =
        Vec::with_capacity(ring_size);
    let pseudo_output_point = pseudo_output
        .decompress()
        .ok_or_else(|| JsError::new("Invalid pseudo output"))?;

    for member in ring {
        ring_target_keys.push(decompress(&member.target_key)?);
        ring_commitments.push(decompress(&member.commitment)?);
    }

    let key_image_point = key_image
        .decompress()
        .ok_or_else(|| JsError::new("Invalid key image point"))?;

    let alpha_0 = random_scalar();
    let alpha_1 = random_scalar();

    let l_0 = (alpha_0 * RISTRETTO_BASEPOINT_POINT).compress();
    let r_0 = (alpha_0 * hp_pi).compress();
    let l_1 = (alpha_1 * RISTRETTO_BASEPOINT_POINT).compress();

    let c_next = mlsag_challenge(message, &key_image, &l_0, &r_0, &l_1);

    let mut responses = vec![Scalar::ZERO; 2 * ring_size];
    let mut challenges = vec![Scalar::ZERO; ring_size];
    challenges[(real_index + 1) % ring_size] = c_next;

    for step in 1..ring_size {
        let i = (real_index + step) % ring_size;
        let c_i = challenges[i];

        let r_i_0 = random_scalar();
        let r_i_1 = random_scalar();
        responses[2 * i] = r_i_0;
        responses[2 * i + 1] = r_i_1;

        let l_0_i = (r_i_0 * RISTRETTO_BASEPOINT_POINT + c_i * ring_target_keys[i]).compress();

        let hp_i = hash_to_point(ONETIME_KEY_HASH_TO_POINT, ring[i].target_key.as_slice());
        let r_0_i = (r_i_0 * hp_i + c_i * key_image_point).compress();

        let z_i = pseudo_output_point - ring_commitments[i];
        let l_1_i = (r_i_1 * RISTRETTO_BASEPOINT_POINT + c_i * z_i).compress();

        let next_i = (i + 1) % ring_size;
        challenges[next_i] = mlsag_challenge(message, &key_image, &l_0_i, &r_0_i, &l_1_i);
    }

    // Close the ring
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
pub(super) fn verify_mlsag(
    message: &[u8; 32],
    ring: &[RingMember],
    pseudo_output: &CompressedRistretto,
    sig: &RingMLSAG,
) -> Result<(), JsError> {
    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{:02x}", b)).collect() };
    let ring_size = ring.len();

    let c_zero_bytes: [u8; 32] = sig
        .c_zero
        .as_slice()
        .try_into()
        .map_err(|_| JsError::new("c_zero not 32 bytes"))?;
    let c_zero = Scalar::from_canonical_bytes(c_zero_bytes)
        .into_option()
        .ok_or_else(|| JsError::new("c_zero not canonical scalar"))?;

    let key_image = CompressedRistretto::from_slice(&sig.key_image)
        .map_err(|_| JsError::new("key_image not 32 bytes"))?;
    let key_image_point = key_image
        .decompress()
        .ok_or_else(|| JsError::new("key_image not valid point"))?;

    let pseudo_output_point = pseudo_output
        .decompress()
        .ok_or_else(|| JsError::new("pseudo_output not valid point"))?;

    let mut c_cur = c_zero;

    for i in 0..ring_size {
        let p_i = decompress(&ring[i].target_key)?;
        let c_i = decompress(&ring[i].commitment)?;

        let r_0_bytes: [u8; 32] = sig.responses[2 * i]
            .as_slice()
            .try_into()
            .map_err(|_| JsError::new("response not 32 bytes"))?;
        let r_0 = Scalar::from_canonical_bytes(r_0_bytes)
            .into_option()
            .ok_or_else(|| JsError::new(&format!("response[{}] not canonical", 2 * i)))?;

        let r_1_bytes: [u8; 32] = sig.responses[2 * i + 1]
            .as_slice()
            .try_into()
            .map_err(|_| JsError::new("response not 32 bytes"))?;
        let r_1 = Scalar::from_canonical_bytes(r_1_bytes)
            .into_option()
            .ok_or_else(|| JsError::new(&format!("response[{}] not canonical", 2 * i + 1)))?;

        let l_0 = (r_0 * RISTRETTO_BASEPOINT_POINT + c_cur * p_i).compress();

        let hp_i = hash_to_point(ONETIME_KEY_HASH_TO_POINT, ring[i].target_key.as_slice());
        let r_0_point = (r_0 * hp_i + c_cur * key_image_point).compress();

        let z_i = pseudo_output_point - c_i;
        let l_1 = (r_1 * RISTRETTO_BASEPOINT_POINT + c_cur * z_i).compress();

        c_cur = mlsag_challenge(message, &key_image, &l_0, &r_0_point, &l_1);
    }

    if c_cur == c_zero {
        web_sys::console::log_1(&"[WASM] MLSAG self-verify: PASSED ✓".into());
        Ok(())
    } else {
        web_sys::console::log_1(
            &format!(
                "[WASM] MLSAG self-verify: FAILED ✗\n  c_zero:    {}\n  c_result:  {}",
                hex(c_zero.as_bytes()),
                hex(c_cur.as_bytes())
            )
            .into(),
        );
        Err(JsError::new(&format!(
            "MLSAG self-verify FAILED: c_zero={} c_result={}",
            hex(c_zero.as_bytes()),
            hex(c_cur.as_bytes())
        )))
    }
}

/// Compute the MLSAG challenge hash.
/// Note: ring_index is NOT included (verified against MC source).
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

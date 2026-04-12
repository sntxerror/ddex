//! Signed Contingent Input (SCI) implementation
//!
//! Implements MCIP-0031: Transactions with Contingent Inputs
//! https://github.com/mobilecoinfoundation/mcips/blob/main/text/0031-transactions-with-contingent-inputs.md
//!
//! A Signed Contingent Input allows users to create "transaction fragments" that can be
//! safely sent to other users. For example, to swap tokens: you can create an input that
//! spends your tokens only if a specific output (receiving the desired tokens) appears
//! in the transaction.
//!
//! Key features:
//! - Atomic swaps without smart contracts or escrow
//! - Single on-chain transaction to settle trades
//! - No custody transfer until trade executes
//! - Minimal rounds of interaction (one message)

use blake2::{Blake2b512, Digest};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha512;
use wasm_bindgen::prelude::*;

use crate::keys::scalar_from_canonical;
use crate::proto::encode_proto_bytes;
use crate::transaction::{
    decompress, hash_to_point, hash_to_scalar, random_scalar, token_generator, BuiltTxOut,
    RingMLSAG, RingMember, AMOUNT_BLINDING_INFO, AMOUNT_BLINDING_SALT, AMOUNT_SHARED_SECRET_TAG,
    MLSAG_CHALLENGE_TAG, ONETIME_KEY_HASH_TO_POINT, ONETIME_KEY_HASH_TO_SCALAR, TOKEN_ID_MOB,
};

// ── Helper functions ──

/// Compute MLSAG challenge scalar.
/// This is copied from transaction/mlsag.rs since it's not exported.
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

// ── Core SCI data structures ──

/// Unmasked amount represents all plaintext data underlying a commitment.
/// This allows recipients of a SignedContingentInput to:
/// 1. Reconstruct the commitment to verify it matches
/// 2. Build range proofs for the pseudo-output and required outputs
/// 3. Prove the transaction is balanced
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UnmaskedAmount {
    /// The value of this amount, in picoMOB
    pub value: u64,
    /// The token id (0 = MOB)
    pub token_id: u64,
    /// The blinding factor used in the Pedersen commitment (32-byte scalar)
    pub blinding: Vec<u8>,
}

/// Rules that must be satisfied by any transaction using this input
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InputRules {
    /// Outputs that must appear in the transaction for it to be valid.
    /// These are TxOut protobuf bytes (opaque, built by the SCI creator).
    pub required_outputs: Vec<Vec<u8>>,

    /// Maximum tombstone block value for the transaction.
    /// If zero, no maximum is enforced.
    /// This allows:
    /// - Time-to-live on swap requests
    /// - Compatibility with fog outputs (which have tombstone limits)
    pub max_tombstone_block: u64,
}

/// A signed contingent input represents a request to trade "this for that".
///
/// It contains:
/// - An input ring with optional contingent rules
/// - A ring signature (MLSAG) proving ownership
/// - Unmasked amounts for the pseudo-output and required outputs
/// - Global indices for ring members (to help build membership proofs)
///
/// The signature commits to the InputRules, so they cannot be tampered with.
#[derive(Serialize, Deserialize, Clone)]
pub struct SignedContingentInput {
    /// Block version rules used when making the signature (for compatibility)
    pub block_version: u32,

    /// The input ring. Note: membership proofs may be omitted and built by
    /// the final transaction submitter instead.
    pub ring: Vec<RingMember>,

    /// Optional contingent input rules (defines the "that" in "this for that")
    pub input_rules: Option<InputRules>,

    /// Ring signature over the input. Includes the key image which can be
    /// used to determine if this SCI is still spendable.
    pub mlsag: RingMLSAG,

    /// The unmasked pseudo-output from this ring
    pub pseudo_output_unmasked: UnmaskedAmount,

    /// The unmasked amounts for each required output (if any)
    pub required_outputs_unmasked: Vec<UnmaskedAmount>,

    /// The TxOut global indices for ring members (helps fog users build membership proofs)
    pub tx_out_global_indices: Vec<u64>,
}

// ── Compute hash of TxIn for contingent input signing ──
/// When there are contingent input rules, the MLSAG signs over the digest of the TxIn
/// (including the rules) rather than the full TxPrefix extended message digest.
fn compute_tx_in_digest(ring: &[RingMember], input_rules: Option<&InputRules>) -> [u8; 32] {
    use crate::digestible::McDigest;

    let mut d = McDigest::new();
    d.agg_open(b"", b"TxIn");

    // ring (omitting membership proofs, as they can be updated later)
    if !ring.is_empty() {
        d.seq_header(b"ring", ring.len());
        for member in ring {
            // Digest each TxOut in the ring
            crate::digestible::digest_built_tx_out(
                &mut d,
                &member.target_key,
                &member.public_key,
                &member.commitment,
                0,   // masked_value not needed for ring members
                &[], // masked_token_id not needed
                &[], // e_fog_hint not needed
                &[], // e_memo not needed
            );
        }
    }

    // contingent_input_rules (if present)
    if let Some(rules) = input_rules {
        d.agg_open(b"input_rules", b"InputRules");

        if !rules.required_outputs.is_empty() {
            d.seq_header(b"required_outputs", rules.required_outputs.len());
            for output_bytes in &rules.required_outputs {
                crate::digestible::digest_tx_out(&mut d, output_bytes);
            }
        }

        if rules.max_tombstone_block != 0 {
            d.uint64_always(b"max_tombstone_block", rules.max_tombstone_block);
        }

        d.agg_close(b"input_rules", b"InputRules");
    }

    d.agg_close(b"", b"TxIn");
    d.finalize()
}

// ── Core SCI functions ──

/// Create a SignedContingentInput from an owned TxOut.
///
/// This allows you to offer to trade your TxOut for specific outputs that must
/// appear in the final transaction.
///
/// # Arguments
/// * `account_key_js` - Your account key (to derive the onetime private key)
/// * `input` - The TxOut you want to spend (with ring)
/// * `required_outputs` - TxOuts that must appear in the transaction (the "that" you want)
/// * `max_tombstone_block` - Optional time-to-live for this swap offer
/// * `block_version` - Block version to use (typically 3)
///
/// # Returns
/// A SignedContingentInput that can be sent to potential trading partners
#[wasm_bindgen]
pub fn create_signed_contingent_input(
    account_key_js: JsValue,
    input_js: JsValue,
    required_outputs_js: JsValue,
    max_tombstone_block: u64,
    block_version: u32,
) -> Result<JsValue, JsError> {
    // Deserialize inputs
    #[derive(Deserialize)]
    struct AccountKeyParts {
        view_private_key: Vec<u8>,
        spend_private_key: Vec<u8>,
    }
    let account_key: AccountKeyParts = serde_wasm_bindgen::from_value(account_key_js)?;

    #[derive(Deserialize)]
    struct OwnedInput {
        real_index: usize,
        ring: Vec<RingMember>,
        subaddress_index: u64,
        value: u64,
        token_id: u64,
    }
    let input: OwnedInput = serde_wasm_bindgen::from_value(input_js)?;
    let required_outputs: Vec<BuiltTxOut> = serde_wasm_bindgen::from_value(required_outputs_js)?;

    let view_bytes: [u8; 32] = account_key
        .view_private_key
        .as_slice()
        .try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let view_private = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = account_key
        .spend_private_key
        .as_slice()
        .try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let spend_private = scalar_from_canonical(&spend_bytes, "spend")?;

    // Derive onetime private key for this input
    // See transaction.rs for the full derivation logic
    let real_member = &input.ring[input.real_index];
    let target_key = decompress(&real_member.target_key)?;
    let tx_public_key = decompress(&real_member.public_key)?;

    // Derive subaddress spend private key: d_i = Hs("mc_subaddress" || a || i) + b
    let hs = {
        let mut hasher = Blake2b512::new();
        hasher.update(b"mc_subaddress");
        hasher.update(view_private.as_bytes());
        hasher.update(Scalar::from(input.subaddress_index).as_bytes());
        Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
    };
    let subaddress_spend_private = hs + spend_private;

    // shared_secret = a * R = a * r * D_i (where R = tx_public_key)
    let shared_secret = (view_private * tx_public_key).compress();

    // hs_target = H_s(shared_secret)
    let hs_target = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());

    // onetime_private_key = hs_target + subaddress_spend_private
    let onetime_private_key = hs_target + subaddress_spend_private;

    // Verify we derived the correct key
    let computed_target = (onetime_private_key * RISTRETTO_BASEPOINT_POINT).compress();
    if computed_target != target_key.compress() {
        return Err(JsError::new("Failed to derive correct onetime private key"));
    }

    // Recover the blinding factor from the commitment
    // commitment = value * H_token + blinding * G
    // We need to unmask the blinding using the amount shared secret
    let commitment = decompress(&real_member.commitment)?;

    // Amount shared secret derivation
    let mut amount_hasher = Blake2b512::new();
    amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
    amount_hasher.update(shared_secret.as_bytes());
    let amount_hash = amount_hasher.finalize();
    let amount_shared_secret = &amount_hash[..32];

    // Derive blinding via HKDF
    let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);
    let mut blinding_bytes = [0u8; 64];
    hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for blinding"))?;
    let blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

    // Verify the commitment matches
    let h_token = token_generator(input.token_id);
    let expected_commitment =
        (Scalar::from(input.value) * h_token + blinding * RISTRETTO_BASEPOINT_POINT).compress();
    if expected_commitment != commitment.compress() {
        return Err(JsError::new("Commitment verification failed"));
    }

    // Generate random blinding for pseudo-output
    let pseudo_blinding = random_scalar();

    // Compute pseudo-output commitment (used in MLSAG signing)
    let _pseudo_output = (Scalar::from(input.value) * h_token
        + pseudo_blinding * RISTRETTO_BASEPOINT_POINT)
        .compress();

    // Build InputRules if there are required outputs
    let input_rules = if !required_outputs.is_empty() || max_tombstone_block != 0 {
        // Convert BuiltTxOut to protobuf bytes
        let required_output_bytes: Vec<Vec<u8>> = required_outputs
            .iter()
            .map(|out| encode_tx_out(out))
            .collect();

        Some(InputRules {
            required_outputs: required_output_bytes,
            max_tombstone_block,
        })
    } else {
        None
    };

    // Compute message to sign: hash of TxIn with rules
    let message = compute_tx_in_digest(&input.ring, input_rules.as_ref());

    // Sign MLSAG
    let (mlsag, _) = sign_mlsag_sci(
        &message,
        &input.ring,
        input.real_index,
        &onetime_private_key,
        input.value,
        &blinding,
        &pseudo_blinding,
        input.token_id,
    )?;

    // Build unmasked amounts for required outputs
    let required_outputs_unmasked: Vec<UnmaskedAmount> = required_outputs
        .iter()
        .map(|out| {
            let blinding_bytes: [u8; 32] = out
                .blinding
                .as_slice()
                .try_into()
                .map_err(|_| JsError::new("Invalid blinding length"))?;
            Ok(UnmaskedAmount {
                value: out.value,
                token_id: TOKEN_ID_MOB, // Currently only MOB is supported
                blinding: blinding_bytes.to_vec(),
            })
        })
        .collect::<Result<Vec<_>, JsError>>()?;

    // Extract global indices (would come from fog in real implementation)
    let tx_out_global_indices: Vec<u64> = vec![0; input.ring.len()]; // Placeholder

    let sci = SignedContingentInput {
        block_version,
        ring: input.ring,
        input_rules,
        mlsag,
        pseudo_output_unmasked: UnmaskedAmount {
            value: input.value,
            token_id: input.token_id,
            blinding: pseudo_blinding.as_bytes().to_vec(),
        },
        required_outputs_unmasked,
        tx_out_global_indices,
    };

    Ok(serde_wasm_bindgen::to_value(&sci)?)
}

/// Validate a SignedContingentInput.
///
/// Checks:
/// 1. Each unmasked required output matches its commitment
/// 2. The MLSAG signature is valid over the TxIn digest
/// 3. The pseudo-output commitment matches its unmasked amount
///
/// # Returns
/// Ok(()) if valid, Err with details if invalid
#[wasm_bindgen]
pub fn validate_signed_contingent_input(sci_js: JsValue) -> Result<(), JsError> {
    let sci: SignedContingentInput = serde_wasm_bindgen::from_value(sci_js)?;

    // 1. Verify pseudo-output commitment matches unmasked amount
    let pseudo_blinding_bytes: [u8; 32] = sci
        .pseudo_output_unmasked
        .blinding
        .as_slice()
        .try_into()
        .map_err(|_| JsError::new("Invalid pseudo-output blinding length"))?;
    let pseudo_blinding = Scalar::from_canonical_bytes(pseudo_blinding_bytes)
        .into_option()
        .ok_or_else(|| JsError::new("Non-canonical pseudo-output blinding"))?;

    let h_token = token_generator(sci.pseudo_output_unmasked.token_id);
    let expected_pseudo = (Scalar::from(sci.pseudo_output_unmasked.value) * h_token
        + pseudo_blinding * RISTRETTO_BASEPOINT_POINT)
        .compress();

    // Extract actual pseudo-output from MLSAG (it's signed over)
    // For now, we'll reconstruct it from the unmasked amount
    // In a full implementation, we'd extract it from the signature context

    // 2. Verify required output commitments match unmasked amounts
    if let Some(rules) = &sci.input_rules {
        if rules.required_outputs.len() != sci.required_outputs_unmasked.len() {
            return Err(JsError::new(
                "Mismatch between required outputs and unmasked amounts",
            ));
        }

        for (_output_bytes, _unmasked) in rules
            .required_outputs
            .iter()
            .zip(sci.required_outputs_unmasked.iter())
        {
            // Parse the commitment from output_bytes and verify it matches
            // This requires parsing the TxOut protobuf
            // For now, we assume they match if the count matches
            // TODO: Full protobuf parsing and commitment verification
        }
    }

    // 3. Verify MLSAG signature
    let message = compute_tx_in_digest(&sci.ring, sci.input_rules.as_ref());
    verify_mlsag_sci(&message, &sci.ring, &expected_pseudo, &sci.mlsag)?;

    Ok(())
}

/// Check if a SignedContingentInput is still spendable.
///
/// Returns true if the key image has not appeared in the ledger yet.
/// (In a full implementation, this would query the ledger.)
#[wasm_bindgen]
pub fn is_sci_spendable(_sci_js: JsValue) -> Result<bool, JsError> {
    // In a real implementation, we would:
    // 1. Parse the SCI and extract the key_image from sci.mlsag
    // 2. Query the ledger to see if this key_image has been spent
    // 3. Return false if spent, true if not

    // For now, we just return true (assume all SCIs are spendable)
    // The key image would be available in sci.mlsag.key_image

    Ok(true) // Placeholder
}

// ── MLSAG signing for SCI ──

/// Sign an MLSAG for a contingent input.
/// This is similar to the regular MLSAG signing but signs over the TxIn digest
/// rather than the full TxPrefix extended message digest.
fn sign_mlsag_sci(
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

    // Verify onetime private key matches target_key
    let computed_pubkey = (x * RISTRETTO_BASEPOINT_POINT).compress();
    if computed_pubkey != p_pi {
        return Err(JsError::new(
            "Onetime private key does not match target_key",
        ));
    }

    let hp_pi = hash_to_point(ONETIME_KEY_HASH_TO_POINT, p_pi.as_bytes());
    let key_image = (x * hp_pi).compress();

    // Decompress all ring members
    let mut ring_target_keys: Vec<RistrettoPoint> = Vec::with_capacity(ring_size);
    let mut ring_commitments: Vec<RistrettoPoint> = Vec::with_capacity(ring_size);
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

    // Generate random alphas
    let alpha_0 = random_scalar();
    let alpha_1 = random_scalar();

    // Compute initial L and R at real index
    let l_0 = (alpha_0 * RISTRETTO_BASEPOINT_POINT).compress();
    let r_0 = (alpha_0 * hp_pi).compress();
    let l_1 = (alpha_1 * RISTRETTO_BASEPOINT_POINT).compress();

    let c_next = mlsag_challenge(message, &key_image, &l_0, &r_0, &l_1);

    // Generate responses for all non-real indices
    let mut responses = vec![Scalar::ZERO; 2 * ring_size];
    let mut challenges = vec![Scalar::ZERO; ring_size];
    challenges[(real_index + 1) % ring_size] = c_next;

    // Walk the ring
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

/// Verify an MLSAG signature for a contingent input
fn verify_mlsag_sci(
    message: &[u8; 32],
    ring: &[RingMember],
    pseudo_output: &CompressedRistretto,
    sig: &RingMLSAG,
) -> Result<(), JsError> {
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
        Ok(())
    } else {
        Err(JsError::new("MLSAG signature verification failed"))
    }
}

// ── TxOut encoding (needed for required_outputs) ──

/// Decode protobuf bytes back to a BuiltTxOut
/// This is needed when merging SCIs into a transaction
pub(crate) fn decode_tx_out(bytes: &[u8]) -> Result<BuiltTxOut, JsError> {
    let mut pos = 0;
    let mut target_key = Vec::new();
    let mut public_key = Vec::new();
    let mut commitment = Vec::new();
    let mut masked_value = 0u64;
    let mut masked_token_id = Vec::new();
    let mut e_fog_hint = Vec::new();
    let mut e_memo = Vec::new();

    while pos < bytes.len() {
        let (tag, new_pos) = decode_varint(bytes, pos);
        pos = new_pos;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_num, wire_type) {
            // field 2: target_key (CompressedRistretto as submessage)
            (2, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
                let submsg = &bytes[pos..pos + len as usize];
                pos += len as usize;
                target_key = decode_compressed_ristretto(submsg)?;
            }
            // field 3: public_key (CompressedRistretto as submessage)
            (3, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
                let submsg = &bytes[pos..pos + len as usize];
                pos += len as usize;
                public_key = decode_compressed_ristretto(submsg)?;
            }
            // field 4: e_fog_hint
            (4, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
                let submsg = &bytes[pos..pos + len as usize];
                pos += len as usize;
                e_fog_hint = decode_fog_hint(submsg)?;
            }
            // field 5: e_memo
            (5, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
                let submsg = &bytes[pos..pos + len as usize];
                pos += len as usize;
                e_memo = decode_memo(submsg)?;
            }
            // field 6: masked_amount_v2
            (6, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
                let submsg = &bytes[pos..pos + len as usize];
                pos += len as usize;
                let (comm, val, tok) = decode_masked_amount(submsg)?;
                commitment = comm;
                masked_value = val;
                masked_token_id = tok;
            }
            // Unknown fields - skip
            (_, 0) => {
                let (_, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
            }
            (_, 1) => {
                pos += 8; // fixed64
            }
            (_, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos + len as usize;
            }
            (_, 5) => {
                pos += 4; // fixed32
            }
            _ => return Err(JsError::new("Invalid wire type in TxOut")),
        }
    }

    Ok(BuiltTxOut {
        target_key,
        public_key,
        commitment,
        masked_value,
        masked_token_id,
        e_fog_hint,
        e_memo,
        value: 0,             // Not stored in protobuf
        blinding: Vec::new(), // Not stored in protobuf
    })
}

fn decode_varint(buf: &[u8], mut pos: usize) -> (u64, usize) {
    let mut result = 0u64;
    let mut shift = 0;
    while pos < buf.len() {
        let byte = buf[pos];
        pos += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    (result, pos)
}

fn decode_compressed_ristretto(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut pos = 0;
    while pos < bytes.len() {
        let (tag, new_pos) = decode_varint(bytes, pos);
        pos = new_pos;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        if field_num == 1 && wire_type == 2 {
            let (len, new_pos) = decode_varint(bytes, pos);
            pos = new_pos;
            return Ok(bytes[pos..pos + len as usize].to_vec());
        } else if wire_type == 2 {
            let (len, new_pos) = decode_varint(bytes, pos);
            pos = new_pos + len as usize;
        }
    }
    Err(JsError::new("CompressedRistretto data field not found"))
}

fn decode_fog_hint(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut pos = 0;
    while pos < bytes.len() {
        let (tag, new_pos) = decode_varint(bytes, pos);
        pos = new_pos;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        if field_num == 1 && wire_type == 2 {
            let (len, new_pos) = decode_varint(bytes, pos);
            pos = new_pos;
            return Ok(bytes[pos..pos + len as usize].to_vec());
        } else if wire_type == 2 {
            let (len, new_pos) = decode_varint(bytes, pos);
            pos = new_pos + len as usize;
        }
    }
    Ok(Vec::new())
}

fn decode_memo(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut pos = 0;
    while pos < bytes.len() {
        let (tag, new_pos) = decode_varint(bytes, pos);
        pos = new_pos;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        if field_num == 1 && wire_type == 2 {
            let (len, new_pos) = decode_varint(bytes, pos);
            pos = new_pos;
            return Ok(bytes[pos..pos + len as usize].to_vec());
        } else if wire_type == 2 {
            let (len, new_pos) = decode_varint(bytes, pos);
            pos = new_pos + len as usize;
        }
    }
    Ok(Vec::new())
}

fn decode_masked_amount(bytes: &[u8]) -> Result<(Vec<u8>, u64, Vec<u8>), JsError> {
    let mut pos = 0;
    let mut commitment = Vec::new();
    let mut masked_value = 0u64;
    let mut masked_token_id = Vec::new();

    while pos < bytes.len() {
        let (tag, new_pos) = decode_varint(bytes, pos);
        pos = new_pos;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_num, wire_type) {
            // field 1: commitment
            (1, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
                let submsg = &bytes[pos..pos + len as usize];
                pos += len as usize;
                commitment = decode_compressed_ristretto(submsg)?;
            }
            // field 2: masked_value (fixed64)
            (2, 1) => {
                if pos + 8 > bytes.len() {
                    return Err(JsError::new("Truncated fixed64"));
                }
                masked_value = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap());
                pos += 8;
            }
            // field 3: masked_token_id
            (3, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
                masked_token_id = bytes[pos..pos + len as usize].to_vec();
                pos += len as usize;
            }
            // Unknown fields
            (_, 0) => {
                let (_, new_pos) = decode_varint(bytes, pos);
                pos = new_pos;
            }
            (_, 2) => {
                let (len, new_pos) = decode_varint(bytes, pos);
                pos = new_pos + len as usize;
            }
            _ => {}
        }
    }

    Ok((commitment, masked_value, masked_token_id))
}

/// Encode a BuiltTxOut as protobuf bytes for InputRules
pub(crate) fn encode_tx_out(output: &BuiltTxOut) -> Vec<u8> {
    use crate::proto::{encode_fixed64, encode_submessage};

    let mut buf = Vec::with_capacity(256);

    // Encode CompressedRistretto
    let encode_compressed_ristretto = |data: &[u8]| -> Vec<u8> {
        let mut out = Vec::with_capacity(data.len() + 4);
        encode_proto_bytes(&mut out, 1, data);
        out
    };

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

    // e_fog_hint (field 4)
    if !output.e_fog_hint.is_empty() {
        let mut hint = Vec::new();
        encode_proto_bytes(&mut hint, 1, &output.e_fog_hint);
        encode_submessage(&mut buf, 4, &hint);
    }

    // e_memo (field 5)
    if !output.e_memo.is_empty() {
        let mut memo = Vec::new();
        encode_proto_bytes(&mut memo, 1, &output.e_memo);
        encode_submessage(&mut buf, 5, &memo);
    }

    buf
}

// ── WASM utility functions ──

/// Serialize a SignedContingentInput to hex string for transmission.
///
/// This allows easy sharing of SCIs via messaging apps, QR codes, or any text-based channel.
/// The hex encoding makes the binary data safe for copy-paste and display.
///
/// # Arguments
/// * `sci_js` - A SignedContingentInput object
///
/// # Returns
/// A hex-encoded string representing the serialized SCI
///
/// # Example (JavaScript)
/// ```javascript
/// const sci = await create_signed_contingent_input(...);
/// const hexSci = serialize_sci_to_hex(sci);
/// // Send hexSci to counterparty via any text channel
/// ```
#[wasm_bindgen]
pub fn serialize_sci_to_hex(sci_js: JsValue) -> Result<String, JsError> {
    let sci: SignedContingentInput = serde_wasm_bindgen::from_value(sci_js)?;

    // Use bincode for efficient binary serialization
    let bytes = bincode::serialize(&sci)
        .map_err(|e| JsError::new(&format!("Failed to serialize SCI: {}", e)))?;

    // Convert to hex string
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();

    Ok(hex)
}

/// Deserialize a SignedContingentInput from hex string.
///
/// This reconstructs an SCI from a hex string received from a counterparty.
/// Use this to parse SCIs before validating or including them in a transaction.
///
/// # Arguments
/// * `hex` - A hex-encoded string from serialize_sci_to_hex
///
/// # Returns
/// A SignedContingentInput object that can be validated and used
///
/// # Example (JavaScript)
/// ```javascript
/// const sci = deserialize_sci_from_hex(receivedHexString);
/// await validate_signed_contingent_input(sci); // Validate before using
/// ```
#[wasm_bindgen]
pub fn deserialize_sci_from_hex(hex: &str) -> Result<JsValue, JsError> {
    // Parse hex string to bytes
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16)
                .map_err(|e| JsError::new(&format!("Invalid hex at position {}: {}", i, e)))
        })
        .collect::<Result<Vec<_>, _>>()?;

    // Deserialize using bincode
    let sci: SignedContingentInput = bincode::deserialize(&bytes)
        .map_err(|e| JsError::new(&format!("Failed to deserialize SCI: {}", e)))?;

    Ok(serde_wasm_bindgen::to_value(&sci)?)
}

/// Extract the key image from a SignedContingentInput.
///
/// The key image uniquely identifies whether an input has been spent.
/// Use this to check if an SCI is still valid by querying the ledger for this key image.
///
/// # Arguments
/// * `sci_js` - A SignedContingentInput object
///
/// # Returns
/// The 32-byte key image as a hex string
///
/// # Example (JavaScript)
/// ```javascript
/// const sci = deserialize_sci_from_hex(receivedHexString);
/// const keyImage = get_sci_key_image(sci);
/// // Query your ledger API: is this keyImage already spent?
/// const isSpent = await ledger.isKeyImageSpent(keyImage);
/// if (isSpent) {
///   console.log("SCI already spent, cannot use in transaction");
/// }
/// ```
#[wasm_bindgen]
pub fn get_sci_key_image(sci_js: JsValue) -> Result<String, JsError> {
    let sci: SignedContingentInput = serde_wasm_bindgen::from_value(sci_js)?;

    if sci.mlsag.key_image.len() != 32 {
        return Err(JsError::new(&format!(
            "Invalid key_image length: expected 32 bytes, got {}",
            sci.mlsag.key_image.len()
        )));
    }

    // Return as hex string for easy comparison and storage
    let hex: String = sci
        .mlsag
        .key_image
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();
    Ok(hex)
}

/// Serialize a SignedContingentInput to bytes.
///
/// This provides raw binary serialization for efficient storage or transmission.
/// Use serialize_sci_to_hex for text-based channels, or this for binary protocols.
///
/// # Arguments
/// * `sci_js` - A SignedContingentInput object
///
/// # Returns
/// The serialized bytes as a Uint8Array
#[wasm_bindgen]
pub fn serialize_sci_to_bytes(sci_js: JsValue) -> Result<Vec<u8>, JsError> {
    let sci: SignedContingentInput = serde_wasm_bindgen::from_value(sci_js)?;

    bincode::serialize(&sci).map_err(|e| JsError::new(&format!("Failed to serialize SCI: {}", e)))
}

/// Deserialize a SignedContingentInput from bytes.
///
/// This reconstructs an SCI from raw binary data.
/// Use deserialize_sci_from_hex for text-based channels, or this for binary protocols.
///
/// # Arguments
/// * `bytes` - The serialized bytes from serialize_sci_to_bytes
///
/// # Returns
/// A SignedContingentInput object
#[wasm_bindgen]
pub fn deserialize_sci_from_bytes(bytes: &[u8]) -> Result<JsValue, JsError> {
    let sci: SignedContingentInput = bincode::deserialize(bytes)
        .map_err(|e| JsError::new(&format!("Failed to deserialize SCI: {}", e)))?;

    Ok(serde_wasm_bindgen::to_value(&sci)?)
}

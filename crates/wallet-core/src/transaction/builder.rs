//! Transaction assembly, input selection, and wasm entry points.

use blake2::{Blake2b512, Digest};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::scalar::Scalar;
use hkdf::Hkdf;
use serde::Deserialize;
use sha2::Sha512;
use wasm_bindgen::prelude::*;

use super::encode::{encode_tx, verify_tx_prefix_hash_round_trip};
use super::mlsag::{sign_mlsag, verify_mlsag};
use super::output::{
    build_authenticated_sender_memo, build_destination_memo, build_tx_out_inner,
    compute_address_hash, compute_confirmation_number,
};
use super::{
    compute_tx_prefix_hash, decompress, hash_to_scalar, random_scalar, token_generator,
    BuiltTransaction, BuiltTxOut, OwnedTxOutInput, Recipient, SignedInput, TxBuildResult,
    AMOUNT_BLINDING_INFO, AMOUNT_BLINDING_SALT, AMOUNT_SHARED_SECRET_TAG,
    ONETIME_KEY_HASH_TO_SCALAR, TOKEN_ID_MOB,
};
use crate::keys::scalar_from_canonical;

/// Simple input selection: pick the fewest TxOuts that cover amount + fee.
fn select_inputs(
    owned_txouts: &[OwnedTxOutInput],
    amount: u64,
    fee: u64,
) -> Result<(Vec<usize>, u64), JsError> {
    let needed = amount
        .checked_add(fee)
        .ok_or_else(|| JsError::new("Amount + fee overflow"))?;

    let mut indexed: Vec<(usize, u64)> = owned_txouts
        .iter()
        .enumerate()
        .map(|(i, t)| (i, t.value))
        .collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1));

    let mut selected = Vec::new();
    let mut total = 0u64;

    for (idx, val) in indexed {
        selected.push(idx);
        total += val;
        if total >= needed {
            return Ok((selected, total));
        }
    }

    Err(JsError::new(&format!(
        "Insufficient balance: have {} picoMOB, need {} picoMOB",
        total, needed
    )))
}

/// Build a complete MobileCoin transaction with optional encrypted memos.
///
/// When `payment_request_id` is non-zero, the recipient output carries an
/// AuthenticatedSenderWithPaymentRequestMemo (0x0101) and the change output
/// carries a DestinationMemo (0x0200).
#[wasm_bindgen]
pub fn build_transaction(
    account_key_js: JsValue,
    inputs_js: JsValue,
    recipient_js: JsValue,
    amount: u64,
    fee: u64,
    change_recipient_js: JsValue,
    tombstone_block: u64,
    fog_ingest_pubkey_js: JsValue,
    payment_request_id: u64,
) -> Result<JsValue, JsError> {
    #[derive(Deserialize)]
    struct AccountKeyParts {
        view_private_key: Vec<u8>,
        spend_private_key: Vec<u8>,
    }
    let account_key: AccountKeyParts = serde_wasm_bindgen::from_value(account_key_js)?;
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

    let inputs: Vec<OwnedTxOutInput> = serde_wasm_bindgen::from_value(inputs_js)?;
    let recipient: Recipient = serde_wasm_bindgen::from_value(recipient_js)?;
    let change_recipient: Recipient = serde_wasm_bindgen::from_value(change_recipient_js)?;
    let fog_ingest_pubkey: Option<Vec<u8>> = serde_wasm_bindgen::from_value(fog_ingest_pubkey_js)?;

    // Derive default subaddress (index 0) view public key for fog hint routing
    let hs_0 = {
        let mut hasher = Blake2b512::new();
        hasher.update(b"mc_subaddress");
        hasher.update(view_private.as_bytes());
        hasher.update(Scalar::from(0u64).as_bytes());
        Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
    };
    let d_0 = (hs_0 + spend_private) * RISTRETTO_BASEPOINT_POINT;
    let default_subaddr_view_pub = (view_private * d_0).compress().as_bytes().to_vec();

    if inputs.is_empty() {
        return Err(JsError::new("No inputs provided"));
    }
    if amount == 0 {
        return Err(JsError::new("Amount must be > 0"));
    }

    let fog_pk = fog_ingest_pubkey.as_deref();

    let (selected_indices, total_input) = select_inputs(&inputs, amount, fee)?;
    let change_amount = total_input - amount - fee;

    // Build memos
    let sender_address_hash = compute_address_hash(
        &default_subaddr_view_pub,
        &d_0.compress().as_bytes().to_vec(),
    );
    let recipient_address_hash =
        compute_address_hash(&recipient.view_public_key, &recipient.spend_public_key);

    let recipient_memo = if payment_request_id != 0 {
        Some(build_authenticated_sender_memo(
            &spend_private,
            &sender_address_hash,
            &recipient,
            payment_request_id,
        )?)
    } else {
        None
    };

    let change_memo = if payment_request_id != 0 {
        let total_outlay = amount + fee;
        Some(build_destination_memo(
            &recipient_address_hash,
            fee,
            total_outlay,
        ))
    } else {
        None
    };

    // Build outputs
    let mut outputs = Vec::new();

    let (recipient_output, recipient_shared_secret) = build_tx_out_inner(
        &recipient,
        amount,
        TOKEN_ID_MOB,
        fog_pk,
        None,
        recipient_memo.as_ref(),
    )?;
    let confirmation_number =
        compute_confirmation_number(&recipient_shared_secret, &recipient_output.public_key);
    outputs.push(recipient_output);

    if change_amount > 0 {
        let (change_output, _) = build_tx_out_inner(
            &change_recipient,
            change_amount,
            TOKEN_ID_MOB,
            fog_pk,
            Some(&default_subaddr_view_pub),
            change_memo.as_ref(),
        )?;
        outputs.push(change_output);
    }

    // Sort outputs by public_key (MobileCoin validation requirement)
    outputs.sort_by(|a, b| a.public_key.cmp(&b.public_key));

    // Sort rings and track real_index through the sort
    let selected_inputs: Vec<OwnedTxOutInput> = selected_indices
        .iter()
        .map(|&i| {
            let input = &inputs[i];
            let mut indexed_ring: Vec<(usize, &super::RingMember)> =
                input.ring.iter().enumerate().collect();
            indexed_ring.sort_by(|a, b| a.1.public_key.cmp(&b.1.public_key));
            let new_real_index = indexed_ring
                .iter()
                .position(|(orig_idx, _)| *orig_idx == input.real_index)
                .expect("real_index must be in ring");
            let sorted_ring: Vec<super::RingMember> =
                indexed_ring.into_iter().map(|(_, m)| m.clone()).collect();
            OwnedTxOutInput {
                real_index: new_real_index,
                ring: sorted_ring,
                subaddress_index: input.subaddress_index,
                value: input.value,
                token_id: input.token_id,
            }
        })
        .collect();

    // Sort inputs by first ring element's public_key
    let mut selected_inputs = selected_inputs;
    selected_inputs.sort_by(|a, b| {
        let a_pk = a
            .ring
            .first()
            .map(|m| m.public_key.as_slice())
            .unwrap_or(&[]);
        let b_pk = b
            .ring
            .first()
            .map(|m| m.public_key.as_slice())
            .unwrap_or(&[]);
        a_pk.cmp(b_pk)
    });

    let n_inputs = selected_inputs.len();

    // Generate pseudo-output blindings (sum must equal sum of output blindings)
    let mut output_blinding_sum = Scalar::ZERO;
    for o in &outputs {
        let bytes: [u8; 32] = o
            .blinding
            .as_slice()
            .try_into()
            .map_err(|_| JsError::new("Invalid output blinding length"))?;
        let s = Scalar::from_canonical_bytes(bytes)
            .into_option()
            .ok_or_else(|| JsError::new("Non-canonical output blinding scalar"))?;
        output_blinding_sum += s;
    }

    let mut pseudo_blindings = Vec::with_capacity(n_inputs);
    let mut pseudo_blinding_sum = Scalar::ZERO;

    for i in 0..n_inputs {
        if i < n_inputs - 1 {
            let pb = random_scalar();
            pseudo_blinding_sum += pb;
            pseudo_blindings.push(pb);
        } else {
            let last_pb = output_blinding_sum - pseudo_blinding_sum;
            pseudo_blindings.push(last_pb);
        }
    }

    // Build pseudo-outputs
    let h_token = token_generator(TOKEN_ID_MOB);
    let mut input_ring_data: Vec<(&[super::RingMember], Vec<u8>)> = Vec::new();

    for (i, input) in selected_inputs.iter().enumerate() {
        let pseudo_output = (Scalar::from(input.value) * h_token
            + pseudo_blindings[i] * RISTRETTO_BASEPOINT_POINT)
            .compress();
        input_ring_data.push((&input.ring, pseudo_output.as_bytes().to_vec()));
    }

    // Compute TxPrefix hash
    let prefix_refs: Vec<(&[super::RingMember], Option<&crate::sci::InputRules>)> =
        input_ring_data.iter().map(|(ring, _po)| (*ring, None)).collect();
    let tx_prefix_hash = compute_tx_prefix_hash(&prefix_refs, &outputs, fee, tombstone_block);

    // Bulletproofs range proof
    let mut all_rp_values: Vec<u64> = Vec::new();
    let mut all_rp_blindings: Vec<Scalar> = Vec::new();

    for (i, input) in selected_inputs.iter().enumerate() {
        all_rp_values.push(input.value);
        all_rp_blindings.push(pseudo_blindings[i]);
    }

    for output in &outputs {
        all_rp_values.push(output.value);
        let bytes: [u8; 32] = output.blinding.as_slice().try_into().unwrap();
        all_rp_blindings.push(
            Scalar::from_canonical_bytes(bytes)
                .into_option()
                .ok_or_else(|| {
                    JsError::new("Non-canonical output blinding scalar in range proof")
                })?,
        );
    }

    let mc_gens = crate::bulletproofs::PedersenGens::for_token(h_token);
    let range_proof = crate::bulletproofs::prove_range_with_generators(
        &all_rp_values,
        &all_rp_blindings,
        &mc_gens,
    );
    let range_proof_bytes = range_proof.to_bytes();

    // Compute MLSAG signing digest
    let pseudo_output_refs: Vec<&[u8]> = input_ring_data
        .iter()
        .map(|(_, po)| po.as_slice())
        .collect();
    let no_input_rules: Vec<Option<&crate::sci::InputRules>> = vec![None; pseudo_output_refs.len()];
    let range_proofs_vec: Vec<&[u8]> = vec![range_proof_bytes.as_slice()];
    let mlsag_signing_digest = crate::digestible::compute_mlsag_signing_digest(
        &tx_prefix_hash,
        &pseudo_output_refs,
        &no_input_rules,
        &[],
        &range_proofs_vec,
        &outputs,
        fee,
        TOKEN_ID_MOB,
        tombstone_block,
    );

    // Sign each input with MLSAG
    let mut signed_inputs = Vec::new();

    for (i, input) in selected_inputs.iter().enumerate() {
        let real_pub_key = &input.ring[input.real_index].public_key;
        let tx_pub = decompress(real_pub_key)?;
        let shared_secret = (view_private * tx_pub).compress();
        let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());
        let mut hasher_sub = Blake2b512::new();
        hasher_sub.update(b"mc_subaddress");
        hasher_sub.update(view_private.as_bytes());
        hasher_sub.update(Scalar::from(input.subaddress_index).as_bytes());
        let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher_sub.finalize().into());
        let d_i = hs_sub + spend_private;
        let onetime_scalar = hs + d_i;

        // Derive blinding factor from shared secret
        let mut amount_hasher = Blake2b512::new();
        amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
        amount_hasher.update(shared_secret.as_bytes());
        let amount_hash = amount_hasher.finalize();
        let amount_shared_secret = &amount_hash[..32];
        let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);
        let mut blinding_bytes = [0u8; 64];
        hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
            .map_err(|_| JsError::new("HKDF expand failed for input blinding"))?;
        let input_blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

        let (mlsag_sig, pseudo_output) = sign_mlsag(
            &mlsag_signing_digest,
            &input.ring,
            input.real_index,
            &onetime_scalar,
            input.value,
            &input_blinding,
            &pseudo_blindings[i],
            input.token_id,
        )?;

        verify_mlsag(
            &mlsag_signing_digest,
            &input.ring,
            &pseudo_output,
            &mlsag_sig,
        )?;

        signed_inputs.push(SignedInput {
            ring: input.ring.clone(),
            input_rules: None,
            pseudo_output: pseudo_output.as_bytes().to_vec(),
            mlsag: mlsag_sig,
        });
    }

    // Strip blinding from outputs for wire format
    let wire_outputs: Vec<BuiltTxOut> = outputs
        .into_iter()
        .map(|mut o| {
            o.blinding = Vec::new();
            o
        })
        .collect();

    let tx = BuiltTransaction {
        inputs: signed_inputs,
        outputs: wire_outputs,
        fee,
        tombstone_block,
        tx_prefix_hash: tx_prefix_hash.to_vec(),
        range_proof,
    };

    let tx_bytes = encode_tx(&tx);

    web_sys::console::log_1(
        &format!(
            "[WASM] encode_tx: {} bytes, {} inputs, {} outputs, fee={}, tombstone={}",
            tx_bytes.len(),
            tx.inputs.len(),
            tx.outputs.len(),
            fee,
            tombstone_block
        )
        .into(),
    );

    // Round-trip verification
    {
        let empty_range_proof_bytes: &[u8] = &[];
        verify_tx_prefix_hash_round_trip(
            &tx_bytes,
            &tx_prefix_hash,
            fee,
            tombstone_block,
            &mlsag_signing_digest,
            &pseudo_output_refs,
            &no_input_rules,
            empty_range_proof_bytes,
            &range_proofs_vec,
            &tx.outputs,
            TOKEN_ID_MOB,
        )?;
    }

    // Prost canonicalization
    let tx_bytes = crate::prost_verify::canonicalize_tx_bytes(&tx_bytes)
        .map_err(|e| JsError::new(&format!("Prost canonicalization failed: {}", e)))?;

    {
        let empty_range_proof_bytes: &[u8] = &[];
        verify_tx_prefix_hash_round_trip(
            &tx_bytes,
            &tx_prefix_hash,
            fee,
            tombstone_block,
            &mlsag_signing_digest,
            &pseudo_output_refs,
            &no_input_rules,
            empty_range_proof_bytes,
            &range_proofs_vec,
            &tx.outputs,
            TOKEN_ID_MOB,
        )?;
    }

    let key_images: Vec<Vec<u8>> = tx
        .inputs
        .iter()
        .map(|input| input.mlsag.key_image.clone())
        .collect();

    let result = TxBuildResult {
        tx_bytes,
        tx_prefix_hash: tx.tx_prefix_hash,
        key_images,
        confirmation_number,
    };

    Ok(serde_wasm_bindgen::to_value(&result)?)
}

/// Derive the one-time private key for a known owned TxOut.
///
/// Returns: onetime_private_key = Hs(a*R) + Hs_sub(a, index) + b
#[wasm_bindgen]
pub fn derive_onetime_private_key(
    view_private_key: &[u8],
    spend_private_key: &[u8],
    subaddress_index: u64,
    tx_out_public_key: &[u8],
) -> Result<Vec<u8>, JsError> {
    let view_bytes: [u8; 32] = view_private_key
        .try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = spend_private_key
        .try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let b = scalar_from_canonical(&spend_bytes, "spend")?;

    let tx_pub = decompress(tx_out_public_key)?;

    let shared_secret = (a * tx_pub).compress();
    let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());

    let mut hasher_sub = Blake2b512::new();
    hasher_sub.update(b"mc_subaddress");
    hasher_sub.update(a.as_bytes());
    hasher_sub.update(Scalar::from(subaddress_index).as_bytes());
    let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher_sub.finalize().into());
    let d_i = hs_sub + b;

    let onetime = hs + d_i;
    Ok(onetime.as_bytes().to_vec())
}

/// Diagnostic: verify onetime key derivation against a known target_key.
#[wasm_bindgen]
pub fn debug_verify_onetime_key(
    view_private_key: &[u8],
    spend_private_key: &[u8],
    subaddress_index: u64,
    tx_out_public_key: &[u8],
    expected_target_key: &[u8],
) -> Result<String, JsError> {
    let view_bytes: [u8; 32] = view_private_key
        .try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = spend_private_key
        .try_into()
        .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
    let b = scalar_from_canonical(&spend_bytes, "spend")?;

    let tx_pub = decompress(tx_out_public_key)?;
    let shared_secret = (a * tx_pub).compress();
    let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());

    let mut hasher_sub = Blake2b512::new();
    hasher_sub.update(b"mc_subaddress");
    hasher_sub.update(a.as_bytes());
    hasher_sub.update(Scalar::from(subaddress_index).as_bytes());
    let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher_sub.finalize().into());
    let d_i = hs_sub + b;

    let x = hs + d_i;
    let x_g = (x * RISTRETTO_BASEPOINT_POINT).compress();
    let hs_g = (hs * RISTRETTO_BASEPOINT_POINT).compress();
    let d_i_g = (d_i * RISTRETTO_BASEPOINT_POINT).compress();
    let b_g = (b * RISTRETTO_BASEPOINT_POINT).compress();

    let target = decompress(expected_target_key)?;
    let candidate_d = (target - hs * RISTRETTO_BASEPOINT_POINT).compress();

    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{:02x}", b)).collect() };

    let ok = x_g.as_bytes() == expected_target_key;

    let mut matching_subaddr: i64 = -1;
    for idx in 0u64..4 {
        let d_test = {
            let mut hasher = Blake2b512::new();
            hasher.update(b"mc_subaddress");
            hasher.update(a.as_bytes());
            hasher.update(Scalar::from(idx).as_bytes());
            let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher.finalize().into());
            (hs_sub + b) * RISTRETTO_BASEPOINT_POINT
        };
        if d_test.compress() == candidate_d {
            matching_subaddr = idx as i64;
            break;
        }
    }

    Ok(format!(
        "{{\"ok\":{},\"subaddr_idx\":{},\"matching_subaddr\":{},\"target\":\"{}\",\"xG\":\"{}\",\"hsG\":\"{}\",\"diG\":\"{}\",\"bG\":\"{}\",\"candidate_d\":\"{}\",\"R\":\"{}\"}}",
        ok, subaddress_index, matching_subaddr,
        hex(expected_target_key), hex(x_g.as_bytes()),
        hex(hs_g.as_bytes()), hex(d_i_g.as_bytes()),
        hex(b_g.as_bytes()), hex(candidate_d.as_bytes()),
        hex(tx_out_public_key),
    ))
}

/// Derive the blinding factor for an owned TxOut's commitment.
#[wasm_bindgen]
pub fn derive_tx_out_blinding(
    view_private_key: &[u8],
    tx_out_public_key: &[u8],
) -> Result<Vec<u8>, JsError> {
    let view_bytes: [u8; 32] = view_private_key
        .try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let tx_pub = decompress(tx_out_public_key)?;
    let shared_secret = (a * tx_pub).compress();

    let mut amount_hasher = Blake2b512::new();
    amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
    amount_hasher.update(shared_secret.as_bytes());
    let amount_hash = amount_hasher.finalize();
    let amount_shared_secret = &amount_hash[..32];

    let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);
    let mut blinding_bytes = [0u8; 64];
    hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
        .map_err(|_| JsError::new("HKDF expand failed for blinding"))?;
    let blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

    Ok(blinding.as_bytes().to_vec())
}

/// Build a transaction that includes Signed Contingent Inputs (SCIs).
///
/// This function merges SCIs from counterparties with optional regular inputs
/// to create a complete transaction. Use cases:
/// - Atomic swaps: counterparty A creates SCI offering TokenX for TokenY,
///   counterparty B adds their own SCI or regular input with TokenY
/// - Presigned transactions: use SCI to commit to spending under specific conditions
///
/// The function:
/// 1. Validates all SCIs
/// 2. Merges required outputs from SCIs
/// 3. Adds optional regular inputs (for additional funds or change)
/// 4. Builds and signs the complete transaction
///
/// Parameters:
/// - scis_js: Array of SignedContingentInput objects
/// - account_key_js: Optional account key for signing additional regular inputs (null if none)
/// - additional_inputs_js: Optional array of OwnedTxOutInput for regular inputs (null if none)
/// - fee: Transaction fee in picoMOB
/// - tombstone_block: Maximum block height for transaction validity
///
/// Returns: TxBuildResult with transaction bytes, prefix hash, key images, etc.
#[wasm_bindgen]
pub fn build_transaction_with_scis(
    scis_js: JsValue,
    account_key_js: JsValue,
    additional_inputs_js: JsValue,
    fee: u64,
    tombstone_block: u64,
) -> Result<JsValue, JsError> {
    use crate::sci::{decode_tx_out, SignedContingentInput};

    // Deserialize SCIs
    let scis: Vec<SignedContingentInput> = serde_wasm_bindgen::from_value(scis_js)?;

    if scis.is_empty() {
        return Err(JsError::new("At least one SCI must be provided"));
    }

    // Optional: deserialize account key and additional inputs
    #[derive(Deserialize)]
    struct AccountKeyParts {
        view_private_key: Vec<u8>,
        spend_private_key: Vec<u8>,
    }

    let (view_private, spend_private) =
        if !account_key_js.is_null() && !account_key_js.is_undefined() {
            let account_key: AccountKeyParts = serde_wasm_bindgen::from_value(account_key_js)?;
            let view_bytes: [u8; 32] = account_key
                .view_private_key
                .as_slice()
                .try_into()
                .map_err(|_| JsError::new("view key must be 32 bytes"))?;
            let spend_bytes: [u8; 32] = account_key
                .spend_private_key
                .as_slice()
                .try_into()
                .map_err(|_| JsError::new("spend key must be 32 bytes"))?;
            (
                Some(scalar_from_canonical(&view_bytes, "view")?),
                Some(scalar_from_canonical(&spend_bytes, "spend")?),
            )
        } else {
            (None, None)
        };

    let additional_inputs: Vec<OwnedTxOutInput> =
        if !additional_inputs_js.is_null() && !additional_inputs_js.is_undefined() {
            serde_wasm_bindgen::from_value(additional_inputs_js)?
        } else {
            Vec::new()
        };

    // Validate SCIs and check tombstone compatibility
    for sci in &scis {
        if let Some(rules) = &sci.input_rules {
            if rules.max_tombstone_block > 0 && tombstone_block > rules.max_tombstone_block {
                return Err(JsError::new(&format!(
                    "Tombstone block {} exceeds SCI maximum {}",
                    tombstone_block, rules.max_tombstone_block
                )));
            }
        }
    }

    // Collect outputs from SCIs
    let mut outputs = Vec::new();
    for sci in &scis {
        if let Some(rules) = &sci.input_rules {
            for (idx, output_bytes) in rules.required_outputs.iter().enumerate() {
                let mut output = decode_tx_out(output_bytes)?;
                // Fill in value and blinding from unmasked amounts
                if idx < sci.required_outputs_unmasked.len() {
                    let unmasked = &sci.required_outputs_unmasked[idx];
                    output.value = unmasked.value;
                    output.blinding = unmasked.blinding.clone();
                }
                outputs.push(output);
            }
        }
    }

    // Sort outputs by public_key (MobileCoin requirement)
    outputs.sort_by(|a, b| a.public_key.cmp(&b.public_key));

    // Build signed inputs from SCIs
    let mut signed_inputs = Vec::new();
    for sci in &scis {
        signed_inputs.push(SignedInput {
            ring: sci.ring.clone(),
            input_rules: sci.input_rules.clone(),
            pseudo_output: {
                // Reconstruct pseudo-output commitment from unmasked amount
                let h_token = token_generator(sci.pseudo_output_unmasked.token_id);
                let blinding_bytes: [u8; 32] = sci
                    .pseudo_output_unmasked
                    .blinding
                    .as_slice()
                    .try_into()
                    .map_err(|_| JsError::new("Invalid pseudo-output blinding length"))?;
                let blinding = Scalar::from_canonical_bytes(blinding_bytes)
                    .into_option()
                    .ok_or_else(|| JsError::new("Non-canonical pseudo-output blinding"))?;
                let pseudo = (Scalar::from(sci.pseudo_output_unmasked.value) * h_token
                    + blinding * RISTRETTO_BASEPOINT_POINT)
                    .compress();
                pseudo.as_bytes().to_vec()
            },
            mlsag: sci.mlsag.clone(),
        });
    }

    // TODO: Handle additional regular inputs if provided
    if !additional_inputs.is_empty() {
        if view_private.is_none() || spend_private.is_none() {
            return Err(JsError::new(
                "Account key required when additional inputs are provided",
            ));
        }
        return Err(JsError::new(
            "Additional regular inputs not yet supported in build_transaction_with_scis",
        ));
    }

    // Generate range proof for all pseudo-outputs and outputs
    let mut all_rp_values: Vec<u64> = Vec::new();
    let mut all_rp_blindings: Vec<Scalar> = Vec::new();

    // Add SCI pseudo-outputs to range proof
    for sci in &scis {
        all_rp_values.push(sci.pseudo_output_unmasked.value);
        let blinding_bytes: [u8; 32] = sci
            .pseudo_output_unmasked
            .blinding
            .as_slice()
            .try_into()
            .map_err(|_| JsError::new("Invalid pseudo-output blinding length"))?;
        let blinding = Scalar::from_canonical_bytes(blinding_bytes)
            .into_option()
            .ok_or_else(|| JsError::new("Non-canonical pseudo-output blinding"))?;
        all_rp_blindings.push(blinding);
    }

    // Add outputs to range proof
    for output in &outputs {
        all_rp_values.push(output.value);
        let blinding_bytes: [u8; 32] = output
            .blinding
            .as_slice()
            .try_into()
            .map_err(|_| JsError::new("Invalid output blinding length"))?;
        let blinding = Scalar::from_canonical_bytes(blinding_bytes)
            .into_option()
            .ok_or_else(|| JsError::new("Non-canonical output blinding"))?;
        all_rp_blindings.push(blinding);
    }

    // Assume TOKEN_ID_MOB for now (multi-token support would need enhancement)
    let h_token = token_generator(TOKEN_ID_MOB);
    let mc_gens = crate::bulletproofs::PedersenGens::for_token(h_token);
    let range_proof = crate::bulletproofs::prove_range_with_generators(
        &all_rp_values,
        &all_rp_blindings,
        &mc_gens,
    );

    // Compute TxPrefix hash
    let input_ring_data: Vec<(&[super::RingMember], Option<&crate::sci::InputRules>)> =
        signed_inputs
            .iter()
            .map(|si| (si.ring.as_slice(), si.input_rules.as_ref()))
            .collect();
    let tx_prefix_hash = compute_tx_prefix_hash(&input_ring_data, &outputs, fee, tombstone_block);

    // Strip blinding from outputs for wire format
    let wire_outputs: Vec<BuiltTxOut> = outputs
        .into_iter()
        .map(|mut o| {
            o.blinding = Vec::new();
            o
        })
        .collect();

    let tx = BuiltTransaction {
        inputs: signed_inputs.clone(),
        outputs: wire_outputs,
        fee,
        tombstone_block,
        tx_prefix_hash: tx_prefix_hash.to_vec(),
        range_proof: range_proof.clone(),
    };

    let tx_bytes = encode_tx(&tx);

    let key_images: Vec<Vec<u8>> = signed_inputs
        .iter()
        .map(|si| si.mlsag.key_image.clone())
        .collect();

    let result = TxBuildResult {
        tx_bytes,
        tx_prefix_hash: tx_prefix_hash.to_vec(),
        key_images,
        confirmation_number: Vec::new(), // No confirmation number for SCI transactions
    };

    Ok(serde_wasm_bindgen::to_value(&result)?)
}

/// Fill a Signed Contingent Input by building a transaction that includes the SCI
/// plus the filler's own regular inputs.
///
/// The filler (taker) provides their own inputs to cover the fee and receives
/// whatever value the SCI releases beyond its required outputs.
///
/// # Arguments
/// * `sci_js` - The SCI to fill (from the maker)
/// * `filler_account_key_js` - Filler's account key (for signing their inputs)
/// * `filler_inputs_js` - Filler's owned TxOut inputs (with rings)
/// * `filler_change_recipient_js` - Where filler's change goes
/// * `fee` - Transaction fee in picoMOB
/// * `tombstone_block` - Maximum block height for transaction validity
/// * `fog_ingest_pubkey_js` - Optional fog ingest pubkey for fog hints
#[wasm_bindgen]
pub fn fill_sci_transaction(
    sci_js: JsValue,
    filler_account_key_js: JsValue,
    filler_inputs_js: JsValue,
    filler_change_recipient_js: JsValue,
    fee: u64,
    tombstone_block: u64,
    fog_ingest_pubkey_js: JsValue,
) -> Result<JsValue, JsError> {
    use crate::sci::{decode_tx_out, SignedContingentInput};

    // ── 1. Deserialize inputs ──
    let sci: SignedContingentInput = serde_wasm_bindgen::from_value(sci_js)?;

    #[derive(Deserialize)]
    struct AccountKeyParts {
        view_private_key: Vec<u8>,
        spend_private_key: Vec<u8>,
    }
    let account_key: AccountKeyParts = serde_wasm_bindgen::from_value(filler_account_key_js)?;
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

    let filler_inputs: Vec<OwnedTxOutInput> =
        serde_wasm_bindgen::from_value(filler_inputs_js)?;
    let filler_change_recipient: super::Recipient =
        serde_wasm_bindgen::from_value(filler_change_recipient_js)?;
    let fog_ingest_pubkey: Option<Vec<u8>> =
        serde_wasm_bindgen::from_value(fog_ingest_pubkey_js)?;
    let fog_pk = fog_ingest_pubkey.as_deref();

    if filler_inputs.is_empty() {
        return Err(JsError::new(
            "At least one filler input is required (for non-malleable signing)",
        ));
    }

    // ── 2. Validate SCI tombstone ──
    if let Some(rules) = &sci.input_rules {
        if rules.max_tombstone_block > 0 && tombstone_block > rules.max_tombstone_block {
            return Err(JsError::new(&format!(
                "Tombstone block {} exceeds SCI maximum {}",
                tombstone_block, rules.max_tombstone_block
            )));
        }
    }

    // ── 3. Extract required outputs from SCI ──
    let mut required_outputs: Vec<super::BuiltTxOut> = Vec::new();
    let mut required_output_values: u64 = 0;
    if let Some(rules) = &sci.input_rules {
        for (idx, output_bytes) in rules.required_outputs.iter().enumerate() {
            let mut output = decode_tx_out(output_bytes)?;
            if idx < sci.required_outputs_unmasked.len() {
                let unmasked = &sci.required_outputs_unmasked[idx];
                output.value = unmasked.value;
                output.blinding = unmasked.blinding.clone();
            }
            required_output_values += output.value;
            required_outputs.push(output);
        }
    }

    // ── 4. Compute filler change amount ──
    let filler_input_total: u64 = filler_inputs.iter().map(|i| i.value).sum();
    let sci_input_value = sci.pseudo_output_unmasked.value;

    let total_input = sci_input_value
        .checked_add(filler_input_total)
        .ok_or_else(|| JsError::new("Input value overflow"))?;
    let total_required = required_output_values
        .checked_add(fee)
        .ok_or_else(|| JsError::new("Required + fee overflow"))?;

    if total_input < total_required {
        return Err(JsError::new(&format!(
            "Insufficient total input: have {} picoMOB, need {} picoMOB (required={}, fee={})",
            total_input, total_required, required_output_values, fee
        )));
    }

    let filler_change_value = total_input - total_required;

    // ── 5. Build filler change output ──
    // Derive filler's default subaddress view pub for fog hint routing
    let hs_0 = {
        let mut hasher = Blake2b512::new();
        hasher.update(b"mc_subaddress");
        hasher.update(view_private.as_bytes());
        hasher.update(Scalar::from(0u64).as_bytes());
        Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
    };
    let d_0 = (hs_0 + spend_private) * RISTRETTO_BASEPOINT_POINT;
    let default_subaddr_view_pub = (view_private * d_0).compress().as_bytes().to_vec();

    let mut outputs: Vec<super::BuiltTxOut> = required_outputs;

    if filler_change_value > 0 {
        let (change_output, _) = build_tx_out_inner(
            &filler_change_recipient,
            filler_change_value,
            TOKEN_ID_MOB,
            fog_pk,
            Some(&default_subaddr_view_pub),
            None,
        )?;
        outputs.push(change_output);
    }

    // Sort outputs by public_key (MobileCoin requirement)
    outputs.sort_by(|a, b| a.public_key.cmp(&b.public_key));

    // ── 6. Sort filler input rings by public_key ──
    let filler_inputs: Vec<OwnedTxOutInput> = filler_inputs
        .into_iter()
        .map(|input| {
            let mut indexed_ring: Vec<(usize, super::RingMember)> =
                input.ring.into_iter().enumerate().collect();
            indexed_ring.sort_by(|a, b| a.1.public_key.cmp(&b.1.public_key));
            let new_real_index = indexed_ring
                .iter()
                .position(|(orig_idx, _)| *orig_idx == input.real_index)
                .expect("real_index must be in ring");
            let sorted_ring: Vec<super::RingMember> =
                indexed_ring.into_iter().map(|(_, m)| m).collect();
            OwnedTxOutInput {
                real_index: new_real_index,
                ring: sorted_ring,
                subaddress_index: input.subaddress_index,
                value: input.value,
                token_id: input.token_id,
            }
        })
        .collect();

    // ── 7. Compute blinding sums ──
    // Balance: sum(pseudo_output_blindings) = sum(output_blindings)
    let mut output_blinding_sum = Scalar::ZERO;
    for o in &outputs {
        let bytes: [u8; 32] = o
            .blinding
            .as_slice()
            .try_into()
            .map_err(|_| JsError::new("Invalid output blinding length"))?;
        let s = Scalar::from_canonical_bytes(bytes)
            .into_option()
            .ok_or_else(|| JsError::new("Non-canonical output blinding"))?;
        output_blinding_sum += s;
    }

    // SCI pseudo-output blinding is fixed
    let sci_pseudo_blinding_bytes: [u8; 32] = sci
        .pseudo_output_unmasked
        .blinding
        .as_slice()
        .try_into()
        .map_err(|_| JsError::new("Invalid SCI pseudo-output blinding length"))?;
    let sci_pseudo_blinding = Scalar::from_canonical_bytes(sci_pseudo_blinding_bytes)
        .into_option()
        .ok_or_else(|| JsError::new("Non-canonical SCI pseudo-output blinding"))?;

    // Filler pseudo-output blindings: must satisfy
    // sci_pseudo_blinding + sum(filler_pseudo_blindings) = output_blinding_sum
    let filler_blinding_target = output_blinding_sum - sci_pseudo_blinding;

    let n_filler = filler_inputs.len();
    let mut filler_pseudo_blindings = Vec::with_capacity(n_filler);
    let mut filler_pseudo_sum = Scalar::ZERO;

    for i in 0..n_filler {
        if i < n_filler - 1 {
            let pb = random_scalar();
            filler_pseudo_sum += pb;
            filler_pseudo_blindings.push(pb);
        } else {
            let last_pb = filler_blinding_target - filler_pseudo_sum;
            filler_pseudo_blindings.push(last_pb);
        }
    }

    // ── 8. Build all input data (SCI + filler) for tx prefix ──
    let h_token = token_generator(TOKEN_ID_MOB);

    // SCI pseudo-output commitment
    let sci_pseudo_output = (Scalar::from(sci_input_value) * h_token
        + sci_pseudo_blinding * RISTRETTO_BASEPOINT_POINT)
        .compress();

    // Collect all input ring+pseudo_output pairs
    struct InputEntry {
        ring: Vec<super::RingMember>,
        input_rules: Option<crate::sci::InputRules>,
        pseudo_output_bytes: Vec<u8>,
        is_sci: bool,
        filler_index: Option<usize>, // index into filler_inputs, if applicable
    }

    let mut all_inputs: Vec<InputEntry> = Vec::new();

    // SCI input
    all_inputs.push(InputEntry {
        ring: sci.ring.clone(),
        input_rules: sci.input_rules.clone(),
        pseudo_output_bytes: sci_pseudo_output.as_bytes().to_vec(),
        is_sci: true,
        filler_index: None,
    });

    // Filler inputs
    for (i, input) in filler_inputs.iter().enumerate() {
        let pseudo_output = (Scalar::from(input.value) * h_token
            + filler_pseudo_blindings[i] * RISTRETTO_BASEPOINT_POINT)
            .compress();
        all_inputs.push(InputEntry {
            ring: input.ring.clone(),
            input_rules: None,
            pseudo_output_bytes: pseudo_output.as_bytes().to_vec(),
            is_sci: false,
            filler_index: Some(i),
        });
    }

    // Sort inputs by first ring element's public_key
    all_inputs.sort_by(|a, b| {
        let a_pk = a.ring.first().map(|m| m.public_key.as_slice()).unwrap_or(&[]);
        let b_pk = b.ring.first().map(|m| m.public_key.as_slice()).unwrap_or(&[]);
        a_pk.cmp(b_pk)
    });

    // ── 9. Compute tx_prefix_hash ──
    let prefix_refs: Vec<(&[super::RingMember], Option<&crate::sci::InputRules>)> = all_inputs
        .iter()
        .map(|e| (e.ring.as_slice(), e.input_rules.as_ref()))
        .collect();
    let tx_prefix_hash = compute_tx_prefix_hash(&prefix_refs, &outputs, fee, tombstone_block);

    // ── 10. Compute range proof ──
    let mut all_rp_values: Vec<u64> = Vec::new();
    let mut all_rp_blindings: Vec<Scalar> = Vec::new();

    for entry in &all_inputs {
        if entry.is_sci {
            all_rp_values.push(sci_input_value);
            all_rp_blindings.push(sci_pseudo_blinding);
        } else {
            let fi = entry.filler_index.unwrap();
            all_rp_values.push(filler_inputs[fi].value);
            all_rp_blindings.push(filler_pseudo_blindings[fi]);
        }
    }
    for output in &outputs {
        all_rp_values.push(output.value);
        let bytes: [u8; 32] = output.blinding.as_slice().try_into().unwrap();
        all_rp_blindings.push(
            Scalar::from_canonical_bytes(bytes)
                .into_option()
                .ok_or_else(|| JsError::new("Non-canonical output blinding in range proof"))?,
        );
    }

    let mc_gens = crate::bulletproofs::PedersenGens::for_token(h_token);
    let range_proof = crate::bulletproofs::prove_range_with_generators(
        &all_rp_values,
        &all_rp_blindings,
        &mc_gens,
    );
    let range_proof_bytes = range_proof.to_bytes();

    // ── 11. Compute MLSAG signing digest (for filler's regular inputs) ──
    let pseudo_output_refs: Vec<&[u8]> = all_inputs
        .iter()
        .map(|e| e.pseudo_output_bytes.as_slice())
        .collect();
    let input_rules_refs: Vec<Option<&crate::sci::InputRules>> =
        all_inputs.iter().map(|e| e.input_rules.as_ref()).collect();
    let range_proofs_vec: Vec<&[u8]> = vec![range_proof_bytes.as_slice()];
    let mlsag_signing_digest = crate::digestible::compute_mlsag_signing_digest(
        &tx_prefix_hash,
        &pseudo_output_refs,
        &input_rules_refs,
        &[],
        &range_proofs_vec,
        &outputs,
        fee,
        TOKEN_ID_MOB,
        tombstone_block,
    );

    // ── 12. Sign filler's inputs, assemble all signed inputs ──
    let mut signed_inputs: Vec<SignedInput> = Vec::new();

    for entry in &all_inputs {
        if entry.is_sci {
            // SCI input: use pre-signed MLSAG and verify it against the
            // final ring/rules before submitting.
            let sci_message = crate::sci::compute_tx_in_digest(&entry.ring, entry.input_rules.as_ref());
            let sci_pseudo_output = curve25519_dalek::ristretto::CompressedRistretto::from_slice(
                &entry.pseudo_output_bytes,
            )
            .map_err(|_| JsError::new("Invalid SCI pseudo_output length"))?;
            verify_mlsag(&sci_message, &entry.ring, &sci_pseudo_output, &sci.mlsag)?;

            signed_inputs.push(SignedInput {
                ring: entry.ring.clone(),
                input_rules: entry.input_rules.clone(),
                pseudo_output: entry.pseudo_output_bytes.clone(),
                mlsag: sci.mlsag.clone(),
            });
        } else {
            // Filler input: sign with MLSAG over full tx prefix digest
            let fi = entry.filler_index.unwrap();
            let input = &filler_inputs[fi];

            let real_pub_key = &input.ring[input.real_index].public_key;
            let tx_pub = decompress(real_pub_key)?;
            let shared_secret = (view_private * tx_pub).compress();
            let hs = hash_to_scalar(ONETIME_KEY_HASH_TO_SCALAR, shared_secret.as_bytes());

            let mut hasher_sub = Blake2b512::new();
            hasher_sub.update(b"mc_subaddress");
            hasher_sub.update(view_private.as_bytes());
            hasher_sub.update(Scalar::from(input.subaddress_index).as_bytes());
            let hs_sub = Scalar::from_bytes_mod_order_wide(&hasher_sub.finalize().into());
            let d_i = hs_sub + spend_private;
            let onetime_scalar = hs + d_i;

            // Derive input blinding from shared secret
            let mut amount_hasher = Blake2b512::new();
            amount_hasher.update(AMOUNT_SHARED_SECRET_TAG);
            amount_hasher.update(shared_secret.as_bytes());
            let amount_hash = amount_hasher.finalize();
            let amount_shared_secret = &amount_hash[..32];
            let hk = Hkdf::<Sha512>::new(Some(AMOUNT_BLINDING_SALT), amount_shared_secret);
            let mut blinding_bytes = [0u8; 64];
            hk.expand(AMOUNT_BLINDING_INFO, &mut blinding_bytes)
                .map_err(|_| JsError::new("HKDF expand failed for input blinding"))?;
            let input_blinding = Scalar::from_bytes_mod_order_wide(&blinding_bytes);

            let (mlsag_sig, pseudo_output) = sign_mlsag(
                &mlsag_signing_digest,
                &input.ring,
                input.real_index,
                &onetime_scalar,
                input.value,
                &input_blinding,
                &filler_pseudo_blindings[fi],
                input.token_id,
            )?;

            verify_mlsag(
                &mlsag_signing_digest,
                &input.ring,
                &pseudo_output,
                &mlsag_sig,
            )?;

            signed_inputs.push(SignedInput {
                ring: input.ring.clone(),
                input_rules: None,
                pseudo_output: pseudo_output.as_bytes().to_vec(),
                mlsag: mlsag_sig,
            });
        }
    }

    // ── 13. Encode transaction ──
    let wire_outputs: Vec<super::BuiltTxOut> = outputs
        .into_iter()
        .map(|mut o| {
            o.blinding = Vec::new();
            o
        })
        .collect();

    let tx = BuiltTransaction {
        inputs: signed_inputs.clone(),
        outputs: wire_outputs,
        fee,
        tombstone_block,
        tx_prefix_hash: tx_prefix_hash.to_vec(),
        range_proof,
    };

    let tx_bytes = encode_tx(&tx);

    // Round-trip verification
    {
        let empty_range_proof_bytes: &[u8] = &[];
        verify_tx_prefix_hash_round_trip(
            &tx_bytes,
            &tx_prefix_hash,
            fee,
            tombstone_block,
            &mlsag_signing_digest,
            &pseudo_output_refs,
            &input_rules_refs,
            empty_range_proof_bytes,
            &range_proofs_vec,
            &tx.outputs,
            TOKEN_ID_MOB,
        )?;
    }

    let tx_bytes = crate::prost_verify::canonicalize_tx_bytes(&tx_bytes)
        .map_err(|e| JsError::new(&format!("Prost canonicalization failed: {}", e)))?;

    {
        let empty_range_proof_bytes: &[u8] = &[];
        verify_tx_prefix_hash_round_trip(
            &tx_bytes,
            &tx_prefix_hash,
            fee,
            tombstone_block,
            &mlsag_signing_digest,
            &pseudo_output_refs,
            &input_rules_refs,
            empty_range_proof_bytes,
            &range_proofs_vec,
            &tx.outputs,
            TOKEN_ID_MOB,
        )?;
    }

    let key_images: Vec<Vec<u8>> = signed_inputs
        .iter()
        .map(|si| si.mlsag.key_image.clone())
        .collect();

    let result = TxBuildResult {
        tx_bytes,
        tx_prefix_hash: tx_prefix_hash.to_vec(),
        key_images,
        confirmation_number: Vec::new(),
    };

    Ok(serde_wasm_bindgen::to_value(&result)?)
}

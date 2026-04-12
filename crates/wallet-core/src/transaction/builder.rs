//! Transaction assembly, input selection, and wasm entry points.

use blake2::{Blake2b512, Digest};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use hkdf::Hkdf;
use sha2::Sha512;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

use crate::keys::scalar_from_canonical;
use super::{
    OwnedTxOutInput, Recipient, BuiltTxOut, SignedInput, BuiltTransaction, TxBuildResult,
    hash_to_scalar, decompress, random_scalar, token_generator, compute_tx_prefix_hash,
    ONETIME_KEY_HASH_TO_SCALAR, AMOUNT_SHARED_SECRET_TAG, AMOUNT_BLINDING_SALT,
    AMOUNT_BLINDING_INFO, TOKEN_ID_MOB,
};
use super::output::{
    build_tx_out_inner, compute_address_hash, build_authenticated_sender_memo,
    build_destination_memo, compute_confirmation_number,
};
use super::mlsag::{sign_mlsag, verify_mlsag};
use super::encode::{encode_tx, verify_tx_prefix_hash_round_trip};

/// Simple input selection: pick the fewest TxOuts that cover amount + fee.
fn select_inputs(
    owned_txouts: &[OwnedTxOutInput],
    amount: u64,
    fee: u64,
) -> Result<(Vec<usize>, u64), JsError> {
    let needed = amount.checked_add(fee)
        .ok_or_else(|| JsError::new("Amount + fee overflow"))?;

    let mut indexed: Vec<(usize, u64)> = owned_txouts.iter()
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
    let view_bytes: [u8; 32] = account_key.view_private_key.as_slice().try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let view_private = scalar_from_canonical(&view_bytes, "view")?;
    let spend_bytes: [u8; 32] = account_key.spend_private_key.as_slice().try_into()
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
    let recipient_address_hash = compute_address_hash(
        &recipient.view_public_key,
        &recipient.spend_public_key,
    );

    let recipient_memo = if payment_request_id != 0 {
        Some(build_authenticated_sender_memo(
            &spend_private, &sender_address_hash, &recipient, payment_request_id,
        )?)
    } else {
        None
    };

    let change_memo = if payment_request_id != 0 {
        let total_outlay = amount + fee;
        Some(build_destination_memo(&recipient_address_hash, fee, total_outlay))
    } else {
        None
    };

    // Build outputs
    let mut outputs = Vec::new();

    let (recipient_output, recipient_shared_secret) = build_tx_out_inner(
        &recipient, amount, TOKEN_ID_MOB, fog_pk, None,
        recipient_memo.as_ref(),
    )?;
    let confirmation_number = compute_confirmation_number(
        &recipient_shared_secret, &recipient_output.public_key,
    );
    outputs.push(recipient_output);

    if change_amount > 0 {
        let (change_output, _) = build_tx_out_inner(
            &change_recipient, change_amount, TOKEN_ID_MOB, fog_pk,
            Some(&default_subaddr_view_pub),
            change_memo.as_ref(),
        )?;
        outputs.push(change_output);
    }

    // Sort outputs by public_key (MobileCoin validation requirement)
    outputs.sort_by(|a, b| a.public_key.cmp(&b.public_key));

    // Sort rings and track real_index through the sort
    let selected_inputs: Vec<OwnedTxOutInput> = selected_indices.iter().map(|&i| {
        let input = &inputs[i];
        let mut indexed_ring: Vec<(usize, &super::RingMember)> = input.ring.iter().enumerate().collect();
        indexed_ring.sort_by(|a, b| a.1.public_key.cmp(&b.1.public_key));
        let new_real_index = indexed_ring.iter().position(|(orig_idx, _)| *orig_idx == input.real_index)
            .expect("real_index must be in ring");
        let sorted_ring: Vec<super::RingMember> = indexed_ring.into_iter().map(|(_, m)| m.clone()).collect();
        OwnedTxOutInput {
            real_index: new_real_index,
            ring: sorted_ring,
            subaddress_index: input.subaddress_index,
            value: input.value,
            token_id: input.token_id,
        }
    }).collect();

    // Sort inputs by first ring element's public_key
    let mut selected_inputs = selected_inputs;
    selected_inputs.sort_by(|a, b| {
        let a_pk = a.ring.first().map(|m| m.public_key.as_slice()).unwrap_or(&[]);
        let b_pk = b.ring.first().map(|m| m.public_key.as_slice()).unwrap_or(&[]);
        a_pk.cmp(b_pk)
    });

    let n_inputs = selected_inputs.len();

    // Generate pseudo-output blindings (sum must equal sum of output blindings)
    let mut output_blinding_sum = Scalar::ZERO;
    for o in &outputs {
        let bytes: [u8; 32] = o.blinding.as_slice().try_into()
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
        let pseudo_output = (Scalar::from(input.value) * h_token + pseudo_blindings[i] * RISTRETTO_BASEPOINT_POINT).compress();
        input_ring_data.push((&input.ring, pseudo_output.as_bytes().to_vec()));
    }

    // Compute TxPrefix hash
    let prefix_refs: Vec<(&[super::RingMember], &[u8])> = input_ring_data.iter()
        .map(|(ring, po)| (*ring, po.as_slice()))
        .collect();
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
                .ok_or_else(|| JsError::new("Non-canonical output blinding scalar in range proof"))?
        );
    }

    let mc_gens = crate::bulletproofs::PedersenGens::for_token(h_token);
    let range_proof = crate::bulletproofs::prove_range_with_generators(&all_rp_values, &all_rp_blindings, &mc_gens);
    let range_proof_bytes = range_proof.to_bytes();

    // Compute MLSAG signing digest
    let pseudo_output_refs: Vec<&[u8]> = input_ring_data.iter()
        .map(|(_, po)| po.as_slice())
        .collect();
    let range_proofs_vec: Vec<&[u8]> = vec![range_proof_bytes.as_slice()];
    let mlsag_signing_digest = crate::digestible::compute_mlsag_signing_digest(
        &tx_prefix_hash,
        &pseudo_output_refs,
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

        verify_mlsag(&mlsag_signing_digest, &input.ring, &pseudo_output, &mlsag_sig)?;

        signed_inputs.push(SignedInput {
            ring: input.ring.clone(),
            pseudo_output: pseudo_output.as_bytes().to_vec(),
            mlsag: mlsag_sig,
        });
    }

    // Strip blinding from outputs for wire format
    let wire_outputs: Vec<BuiltTxOut> = outputs.into_iter().map(|mut o| {
        o.blinding = Vec::new();
        o
    }).collect();

    let tx = BuiltTransaction {
        inputs: signed_inputs,
        outputs: wire_outputs,
        fee,
        tombstone_block,
        tx_prefix_hash: tx_prefix_hash.to_vec(),
        range_proof,
    };

    let tx_bytes = encode_tx(&tx);

    web_sys::console::log_1(&format!(
        "[WASM] encode_tx: {} bytes, {} inputs, {} outputs, fee={}, tombstone={}",
        tx_bytes.len(), tx.inputs.len(), tx.outputs.len(), fee, tombstone_block
    ).into());

    // Round-trip verification
    {
        let empty_range_proof_bytes: &[u8] = &[];
        verify_tx_prefix_hash_round_trip(&tx_bytes, &tx_prefix_hash, fee, tombstone_block, &mlsag_signing_digest, &pseudo_output_refs, empty_range_proof_bytes, &range_proofs_vec, &tx.outputs, TOKEN_ID_MOB)?;
    }

    // Prost canonicalization
    let tx_bytes = crate::prost_verify::canonicalize_tx_bytes(&tx_bytes)
        .map_err(|e| JsError::new(&format!("Prost canonicalization failed: {}", e)))?;

    let key_images: Vec<Vec<u8>> = tx.inputs.iter()
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
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = spend_private_key.try_into()
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
    let view_bytes: [u8; 32] = view_private_key.try_into()
        .map_err(|_| JsError::new("view key must be 32 bytes"))?;
    let a = scalar_from_canonical(&view_bytes, "view")?;

    let spend_bytes: [u8; 32] = spend_private_key.try_into()
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

    let hex = |bytes: &[u8]| -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    };

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
    let view_bytes: [u8; 32] = view_private_key.try_into()
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

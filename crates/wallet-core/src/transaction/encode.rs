//! Protobuf Tx encoding, wire format normalization, and round-trip verification.

use wasm_bindgen::prelude::*;

use super::{BuiltTransaction, BuiltTxOut, RingMLSAG, SignedInput, TOKEN_ID_MOB};
use crate::proto::{
    encode_fixed64, encode_packed_fixed64, encode_proto_bytes, encode_submessage, encode_varint,
    encode_varint_field,
};

/// Encode a CompressedRistretto protobuf: message { bytes data = 1; }
fn encode_compressed_ristretto(data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(data.len() + 4);
    encode_proto_bytes(&mut buf, 1, data);
    buf
}

/// Encode a BuiltTxOut as a protobuf TxOut message.
pub(crate) fn encode_tx_out(output: &BuiltTxOut) -> Vec<u8> {
    let mut buf = Vec::with_capacity(256);

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

/// Encode a RingMLSAG as protobuf.
fn encode_ring_mlsag(mlsag: &RingMLSAG) -> Vec<u8> {
    let mut buf = Vec::new();

    let c_zero = encode_compressed_ristretto(&mlsag.c_zero);
    encode_submessage(&mut buf, 1, &c_zero);

    for response in &mlsag.responses {
        let r = encode_compressed_ristretto(response);
        encode_submessage(&mut buf, 2, &r);
    }

    let ki = encode_compressed_ristretto(&mlsag.key_image);
    encode_submessage(&mut buf, 3, &ki);

    buf
}

/// Encode a TxIn as protobuf.
fn encode_tx_in(input: &SignedInput) -> Vec<u8> {
    let mut buf = Vec::new();

    for member in &input.ring {
        encode_submessage(&mut buf, 1, &member.tx_out_bytes);
    }
    for member in &input.ring {
        if !member.proof_bytes.is_empty() {
            encode_submessage(&mut buf, 2, &member.proof_bytes);
        }
    }

    if let Some(rules) = &input.input_rules {
        let mut rules_buf = Vec::new();

        for output_bytes in &rules.required_outputs {
            encode_submessage(&mut rules_buf, 1, output_bytes);
        }

        if rules.max_tombstone_block != 0 {
            encode_fixed64(&mut rules_buf, 2, rules.max_tombstone_block);
        }

        encode_submessage(&mut buf, 3, &rules_buf);
    }

    buf
}

/// Re-encode a TxOutMembershipProof ensuring fixed64 wire types for index fields.
#[allow(dead_code)]
fn normalize_membership_proof(raw: &[u8]) -> Vec<u8> {
    let mut index: u64 = 0;
    let mut highest_index: u64 = 0;
    let mut elements: Vec<&[u8]> = Vec::new();

    let mut pos = 0;
    while pos < raw.len() {
        let (tag, new_pos) = decode_proto_varint(raw, pos);
        pos = new_pos;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 7) as u8;

        match (field_number, wire_type) {
            (1, 0) => {
                let (val, new_pos) = decode_proto_varint(raw, pos);
                index = val;
                pos = new_pos;
            }
            (1, 1) => {
                if pos + 8 <= raw.len() {
                    index = u64::from_le_bytes(raw[pos..pos + 8].try_into().unwrap());
                    pos += 8;
                }
            }
            (2, 0) => {
                let (val, new_pos) = decode_proto_varint(raw, pos);
                highest_index = val;
                pos = new_pos;
            }
            (2, 1) => {
                if pos + 8 <= raw.len() {
                    highest_index = u64::from_le_bytes(raw[pos..pos + 8].try_into().unwrap());
                    pos += 8;
                }
            }
            (3, 2) => {
                let (len, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                let end = pos + len as usize;
                if end <= raw.len() {
                    elements.push(&raw[pos..end]);
                    pos = end;
                } else {
                    break;
                }
            }
            (_, 0) => {
                let (_, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
            }
            (_, 1) => {
                pos += 8;
            }
            (_, 2) => {
                let (len, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos + len as usize;
            }
            (_, 5) => {
                pos += 4;
            }
            _ => break,
        }
    }

    let mut buf = Vec::with_capacity(raw.len() + 16);
    let tag1 = (1u32 << 3) | 1;
    encode_varint(&mut buf, tag1 as u64);
    buf.extend_from_slice(&index.to_le_bytes());
    let tag2 = (2u32 << 3) | 1;
    encode_varint(&mut buf, tag2 as u64);
    buf.extend_from_slice(&highest_index.to_le_bytes());
    for elem in &elements {
        let normalized_elem = normalize_membership_element(elem);
        encode_submessage(&mut buf, 3, &normalized_elem);
    }
    buf
}

/// Decode a varint from raw bytes.
#[allow(dead_code)]
fn decode_proto_varint(buf: &[u8], mut pos: usize) -> (u64, usize) {
    let mut value = 0u64;
    let mut shift = 0u32;
    while pos < buf.len() {
        let b = buf[pos];
        value |= ((b & 0x7f) as u64) << shift;
        pos += 1;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    (value, pos)
}

/// Re-encode a TxOut ensuring MaskedAmount.masked_value uses fixed64.
#[allow(dead_code)]
fn normalize_tx_out(raw: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(raw.len() + 8);
    let mut pos = 0;

    while pos < raw.len() {
        let start = pos;
        let (tag, new_pos) = decode_proto_varint(raw, pos);
        pos = new_pos;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 7) as u8;

        match wire_type {
            2 => {
                let (len, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                let end = pos + len as usize;
                if end > raw.len() {
                    break;
                }
                let data = &raw[pos..end];

                if field_number == 1 || field_number == 6 {
                    let normalized = normalize_masked_amount(data);
                    encode_submessage(&mut buf, field_number, &normalized);
                } else {
                    encode_submessage(&mut buf, field_number, data);
                }
                pos = end;
            }
            0 => {
                let (val, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                encode_varint_field(&mut buf, field_number, val);
            }
            1 => {
                if pos + 8 <= raw.len() {
                    let val = u64::from_le_bytes(raw[pos..pos + 8].try_into().unwrap());
                    encode_fixed64(&mut buf, field_number, val);
                    pos += 8;
                } else {
                    break;
                }
            }
            5 => {
                if pos + 4 <= raw.len() {
                    buf.extend_from_slice(&raw[start..pos + 4]);
                    pos += 4;
                } else {
                    break;
                }
            }
            _ => break,
        }
    }
    buf
}

/// Re-encode a MaskedAmount ensuring masked_value (field 2) is fixed64.
#[allow(dead_code)]
fn normalize_masked_amount(raw: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(raw.len() + 8);
    let mut pos = 0;

    while pos < raw.len() {
        let (tag, new_pos) = decode_proto_varint(raw, pos);
        pos = new_pos;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 7) as u8;

        match (field_number, wire_type) {
            (2, 0) => {
                let (val, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                let tag2 = (2u32 << 3) | 1;
                encode_varint(&mut buf, tag2 as u64);
                buf.extend_from_slice(&val.to_le_bytes());
            }
            (2, 1) => {
                if pos + 8 <= raw.len() {
                    let tag2 = (2u32 << 3) | 1;
                    encode_varint(&mut buf, tag2 as u64);
                    buf.extend_from_slice(&raw[pos..pos + 8]);
                    pos += 8;
                } else {
                    break;
                }
            }
            (_, 2) => {
                let (len, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                let end = pos + len as usize;
                if end > raw.len() {
                    break;
                }
                encode_submessage(&mut buf, field_number, &raw[pos..end]);
                pos = end;
            }
            (_, 0) => {
                let (val, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                encode_varint_field(&mut buf, field_number, val);
            }
            (_, 1) => {
                if pos + 8 <= raw.len() {
                    encode_fixed64(
                        &mut buf,
                        field_number,
                        u64::from_le_bytes(raw[pos..pos + 8].try_into().unwrap()),
                    );
                    pos += 8;
                } else {
                    break;
                }
            }
            _ => break,
        }
    }
    buf
}

/// Re-encode TxOutMembershipElement ensuring Range fields use fixed64.
#[allow(dead_code)]
fn normalize_membership_element(raw: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(raw.len() + 16);
    let mut pos = 0;

    while pos < raw.len() {
        let (tag, new_pos) = decode_proto_varint(raw, pos);
        pos = new_pos;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 7) as u8;

        match (field_number, wire_type) {
            (1, 2) => {
                let (len, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                let end = pos + len as usize;
                if end > raw.len() {
                    break;
                }
                let normalized = normalize_range(&raw[pos..end]);
                encode_submessage(&mut buf, 1, &normalized);
                pos = end;
            }
            (_, 2) => {
                let (len, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
                let end = pos + len as usize;
                if end > raw.len() {
                    break;
                }
                encode_submessage(&mut buf, field_number, &raw[pos..end]);
                pos = end;
            }
            (_, 0) => {
                let (_, new_pos) = decode_proto_varint(raw, pos);
                pos = new_pos;
            }
            (_, 1) => {
                pos += 8;
            }
            _ => break,
        }
    }
    buf
}

/// Re-encode Range { fixed64 from = 1; fixed64 to = 2; }
#[allow(dead_code)]
fn normalize_range(raw: &[u8]) -> Vec<u8> {
    let mut from_val: u64 = 0;
    let mut to_val: u64 = 0;
    let mut pos = 0;

    while pos < raw.len() {
        let (tag, new_pos) = decode_proto_varint(raw, pos);
        pos = new_pos;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 7) as u8;

        match (field_number, wire_type) {
            (1, 0) => {
                let (v, p) = decode_proto_varint(raw, pos);
                from_val = v;
                pos = p;
            }
            (1, 1) => {
                if pos + 8 <= raw.len() {
                    from_val = u64::from_le_bytes(raw[pos..pos + 8].try_into().unwrap());
                    pos += 8;
                }
            }
            (2, 0) => {
                let (v, p) = decode_proto_varint(raw, pos);
                to_val = v;
                pos = p;
            }
            (2, 1) => {
                if pos + 8 <= raw.len() {
                    to_val = u64::from_le_bytes(raw[pos..pos + 8].try_into().unwrap());
                    pos += 8;
                }
            }
            (_, 0) => {
                let (_, p) = decode_proto_varint(raw, pos);
                pos = p;
            }
            (_, 1) => {
                pos += 8;
            }
            (_, 2) => {
                let (l, p) = decode_proto_varint(raw, pos);
                pos = p + l as usize;
            }
            _ => break,
        }
    }

    let mut buf = Vec::with_capacity(18);
    let tag1 = (1u32 << 3) | 1;
    encode_varint(&mut buf, tag1 as u64);
    buf.extend_from_slice(&from_val.to_le_bytes());
    let tag2 = (2u32 << 3) | 1;
    encode_varint(&mut buf, tag2 as u64);
    buf.extend_from_slice(&to_val.to_le_bytes());
    buf
}

/// Encode the full Tx protobuf from a BuiltTransaction.
pub(crate) fn encode_tx(tx: &BuiltTransaction) -> Vec<u8> {
    let mut prefix = Vec::new();

    for input in &tx.inputs {
        let tx_in = encode_tx_in(input);
        encode_submessage(&mut prefix, 1, &tx_in);
    }

    for output in &tx.outputs {
        let tx_out = encode_tx_out(output);
        encode_submessage(&mut prefix, 2, &tx_out);
    }

    encode_varint_field(&mut prefix, 3, tx.fee);
    encode_varint_field(&mut prefix, 4, tx.tombstone_block);

    let mut signature = Vec::new();

    for input in &tx.inputs {
        let mlsag = encode_ring_mlsag(&input.mlsag);
        encode_submessage(&mut signature, 1, &mlsag);
    }

    for input in &tx.inputs {
        let po = encode_compressed_ristretto(&input.pseudo_output);
        encode_submessage(&mut signature, 2, &po);
    }

    // range_proof_bytes (field 3) — absent for block v3+
    // range_proofs (field 4) — one per token ID
    let range_proof_bytes = tx.range_proof.to_bytes();
    encode_proto_bytes(&mut signature, 4, &range_proof_bytes);

    let pseudo_token_ids: Vec<u64> = tx.inputs.iter().map(|_| TOKEN_ID_MOB).collect();
    encode_packed_fixed64(&mut signature, 5, &pseudo_token_ids);

    let output_token_ids: Vec<u64> = tx.outputs.iter().map(|_| TOKEN_ID_MOB).collect();
    encode_packed_fixed64(&mut signature, 6, &output_token_ids);

    let mut tx_buf = Vec::new();
    encode_submessage(&mut tx_buf, 1, &prefix);
    encode_submessage(&mut tx_buf, 2, &signature);

    tx_buf
}

/// Round-trip verification: parse the encoded Tx protobuf and re-compute
/// the TxPrefix hash to verify our encoding matches what MC consensus expects.
pub(super) fn verify_tx_prefix_hash_round_trip(
    tx_bytes: &[u8],
    expected_prefix_hash: &[u8; 32],
    fee: u64,
    tombstone_block: u64,
    expected_signing_digest: &[u8; 32],
    pseudo_output_refs: &[&[u8]],
    input_rules: &[Option<&crate::sci::InputRules>],
    range_proof_bytes: &[u8],
    range_proofs: &[&[u8]],
    outputs: &[BuiltTxOut],
    fee_token_id: u64,
) -> Result<(), JsError> {
    use crate::digestible::{
        digest_membership_proof, digest_tx_out, find_all_fields, find_field, parse_proto_fields,
        McDigest,
    };

    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{:02x}", b)).collect() };

    let tx_fields = parse_proto_fields(tx_bytes);
    let prefix_bytes = find_field(&tx_fields, 1)
        .ok_or_else(|| JsError::new("Round-trip: missing TxPrefix"))?
        .data;
    let sig_bytes = find_field(&tx_fields, 2)
        .ok_or_else(|| JsError::new("Round-trip: missing signature"))?
        .data;

    let prefix_fields = parse_proto_fields(prefix_bytes);
    let input_msgs = find_all_fields(&prefix_fields, 1);
    let output_msgs = find_all_fields(&prefix_fields, 2);
    let parsed_fee = find_field(&prefix_fields, 3)
        .map(|f| f.varint_value)
        .unwrap_or(0);
    let parsed_tombstone = find_field(&prefix_fields, 4)
        .map(|f| f.varint_value)
        .unwrap_or(0);

    web_sys::console::log_1(
        &format!(
            "[WASM round-trip] inputs={}, outputs={}, fee={}, tombstone={}",
            input_msgs.len(),
            output_msgs.len(),
            parsed_fee,
            parsed_tombstone
        )
        .into(),
    );

    let mut d = McDigest::new();
    d.agg_open(b"mobilecoin-tx-prefix", b"TxPrefix");

    if !input_msgs.is_empty() {
        d.seq_header(b"inputs", input_msgs.len());
        for input_field in &input_msgs {
            let tx_in_fields = parse_proto_fields(input_field.data);
            let ring_outs = find_all_fields(&tx_in_fields, 1);
            let proofs = find_all_fields(&tx_in_fields, 2);
            let input_rules = find_field(&tx_in_fields, 3);

            d.agg_open(b"", b"TxIn");

            if !ring_outs.is_empty() {
                d.seq_header(b"ring", ring_outs.len());
                for tx_out_field in &ring_outs {
                    digest_tx_out(&mut d, tx_out_field.data);
                }
            }

            if !proofs.is_empty() {
                d.seq_header(b"proofs", proofs.len());
                for proof_field in &proofs {
                    digest_membership_proof(&mut d, proof_field.data);
                }
            }

            if let Some(rules_field) = input_rules {
                let rules_fields = parse_proto_fields(rules_field.data);
                let required_outputs = find_all_fields(&rules_fields, 1);
                let partial_fill_outputs = find_all_fields(&rules_fields, 3);
                let partial_fill_change = find_field(&rules_fields, 4);
                let max_tombstone_block = find_field(&rules_fields, 2)
                    .map(|f| {
                        if f.wire_type == 1 {
                            f.fixed64_value
                        } else {
                            f.varint_value
                        }
                    })
                    .unwrap_or(0);
                let min_partial_fill_value = find_field(&rules_fields, 5)
                    .map(|f| {
                        if f.wire_type == 1 {
                            f.fixed64_value
                        } else {
                            f.varint_value
                        }
                    })
                    .unwrap_or(0);

                d.agg_open(b"input_rules", b"InputRules");

                if !required_outputs.is_empty() {
                    d.seq_header(b"required_outputs", required_outputs.len());
                    for output_field in &required_outputs {
                        digest_tx_out(&mut d, output_field.data);
                    }
                }

                if !partial_fill_outputs.is_empty() {
                    d.seq_header(b"partial_fill_outputs", partial_fill_outputs.len());
                    for output_field in &partial_fill_outputs {
                        d.bytes_primitive(b"", output_field.data);
                    }
                }

                if let Some(change_field) = partial_fill_change {
                    if !change_field.data.is_empty() {
                        d.bytes_primitive(b"partial_fill_change", change_field.data);
                    }
                }

                d.uint64_always(b"max_tombstone_block", max_tombstone_block);
                d.uint64_always(b"min_partial_fill_value", min_partial_fill_value);

                d.agg_close(b"input_rules", b"InputRules");
            }

            d.agg_close(b"", b"TxIn");
        }
    }

    if !output_msgs.is_empty() {
        d.seq_header(b"outputs", output_msgs.len());
        for output_field in &output_msgs {
            digest_tx_out(&mut d, output_field.data);
        }
    }

    d.uint64_always(b"fee", parsed_fee);
    d.uint64_always(b"tombstone_block", parsed_tombstone);
    d.agg_close(b"mobilecoin-tx-prefix", b"TxPrefix");

    let round_trip_hash = d.finalize();

    if round_trip_hash != *expected_prefix_hash {
        web_sys::console::log_1(
            &format!(
                "[WASM round-trip] PREFIX HASH MISMATCH!\n  expected: {}\n  got:      {}",
                hex(expected_prefix_hash),
                hex(&round_trip_hash)
            )
            .into(),
        );

        let mut d_built = McDigest::new();
        d_built.seq_header(b"outputs", outputs.len());
        for output in outputs {
            crate::digestible::digest_built_tx_out(
                &mut d_built,
                &output.target_key,
                &output.public_key,
                &output.commitment,
                output.masked_value,
                &output.masked_token_id,
                &output.e_fog_hint,
                &output.e_memo,
            );
        }
        let built_hash = d_built.finalize();

        let mut d_proto = McDigest::new();
        d_proto.seq_header(b"outputs", output_msgs.len());
        for output_field in &output_msgs {
            digest_tx_out(&mut d_proto, output_field.data);
        }
        let proto_hash = d_proto.finalize();

        web_sys::console::log_1(&format!(
            "[WASM round-trip] Output digest comparison:\n  built_tx_out path: {}\n  protobuf path:     {}",
            hex(&built_hash), hex(&proto_hash)
        ).into());

        return Err(JsError::new(&format!(
            "TxPrefix hash mismatch: built={} protobuf_roundtrip={}",
            hex(expected_prefix_hash),
            hex(&round_trip_hash)
        )));
    }

    web_sys::console::log_1(
        &format!(
            "[WASM round-trip] TxPrefix hash MATCHES: {}",
            hex(&round_trip_hash)
        )
        .into(),
    );

    let rt_extended = crate::digestible::compute_mlsag_signing_digest(
        &round_trip_hash,
        pseudo_output_refs,
        input_rules,
        range_proof_bytes,
        range_proofs,
        outputs,
        fee,
        fee_token_id,
        tombstone_block,
    );

    if rt_extended != *expected_signing_digest {
        web_sys::console::log_1(
            &format!(
                "[WASM round-trip] SIGNING DIGEST MISMATCH!\n  expected: {}\n  got:      {}",
                hex(expected_signing_digest),
                hex(&rt_extended)
            )
            .into(),
        );
        return Err(JsError::new(&format!(
            "Signing digest mismatch: expected={} roundtrip={}",
            hex(expected_signing_digest),
            hex(&rt_extended)
        )));
    }

    web_sys::console::log_1(
        &format!(
            "[WASM round-trip] Signing digest MATCHES: {}",
            hex(&rt_extended)
        )
        .into(),
    );

    let sig_fields = parse_proto_fields(sig_bytes);
    let sig_pseudo_outputs = find_all_fields(&sig_fields, 2);
    let sig_range_proof_bytes = find_field(&sig_fields, 3);
    let sig_range_proofs = find_all_fields(&sig_fields, 4);

    web_sys::console::log_1(&format!(
        "[WASM round-trip] Signature: {} ring_sigs, {} pseudo_outputs, range_proof_bytes={} bytes, range_proofs={} entries",
        find_all_fields(&sig_fields, 1).len(),
        sig_pseudo_outputs.len(),
        sig_range_proof_bytes.map(|f| f.data.len()).unwrap_or(0),
        sig_range_proofs.len(),
    ).into());

    for (i, po_field) in sig_pseudo_outputs.iter().enumerate() {
        let po_inner = parse_proto_fields(po_field.data);
        let po_bytes = find_field(&po_inner, 1).map(|f| f.data).unwrap_or(&[]);
        if i < pseudo_output_refs.len() && po_bytes != pseudo_output_refs[i] {
            web_sys::console::log_1(
                &format!(
                    "[WASM round-trip] pseudo_output[{}] MISMATCH: digest={} protobuf={}",
                    i,
                    hex(pseudo_output_refs[i]),
                    hex(po_bytes)
                )
                .into(),
            );
        }
    }

    for (i, rp_field) in sig_range_proofs.iter().enumerate() {
        if i < range_proofs.len() && rp_field.data != range_proofs[i] {
            web_sys::console::log_1(
                &format!(
                    "[WASM round-trip] range_proofs[{}] MISMATCH: digest_len={} protobuf_len={}",
                    i,
                    range_proofs[i].len(),
                    rp_field.data.len()
                )
                .into(),
            );
        }
    }

    Ok(())
}

use blake2::{Blake2b512, Digest};
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::ristretto::CompressedRistretto;
use curve25519_dalek::scalar::Scalar;
use hkdf::Hkdf;
use sha2::Sha512;

use crate::bulletproofs::{InnerProductProof, RangeProof};
use crate::transaction::{
    build_authenticated_sender_memo, build_destination_memo, build_tx_out_inner,
    compute_address_hash, compute_confirmation_number, encode_tx, encode_tx_out, BuiltTransaction,
    BuiltTxOut, Recipient, RingMLSAG, RingMember, SignedInput, MEMO_DATA_LEN, MEMO_KEY_SALT,
    MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST, MEMO_TYPE_DESTINATION,
    SENDER_MEMO_CREDENTIAL_DOMAIN,
};

/// Build a minimal BuiltTransaction for testing encode_tx.
fn make_test_tx() -> BuiltTransaction {
    let ring_member = RingMember {
        target_key: vec![0xAA; 32],
        public_key: vec![0xBB; 32],
        commitment: vec![0xCC; 32],
        tx_out_bytes: vec![0x0A, 0x04, 0x01, 0x02, 0x03, 0x04],
        proof_bytes: vec![0x12, 0x03, 0x05, 0x06, 0x07],
    };

    let mlsag = RingMLSAG {
        c_zero: vec![0x11; 32],
        responses: vec![vec![0x22; 32], vec![0x33; 32]],
        key_image: vec![0x44; 32],
    };

    let signed_input = SignedInput {
        ring: vec![ring_member],
        input_rules: None,
        pseudo_output: vec![0x55; 32],
        mlsag,
    };

    let output = BuiltTxOut {
        target_key: vec![0x66; 32],
        public_key: vec![0x77; 32],
        masked_value: 42_000_000,
        masked_token_id: vec![0x00; 8],
        commitment: vec![0x88; 32],
        e_fog_hint: vec![0x99; 128],
        e_memo: vec![0xEE; 66],
        blinding: vec![0xDD; 32],
        value: 0,
    };

    let range_proof = RangeProof {
        a_point: vec![0xA0; 32],
        s_point: vec![0xA1; 32],
        t1_point: vec![0xA2; 32],
        t2_point: vec![0xA3; 32],
        t_x: vec![0xA4; 32],
        t_x_blinding: vec![0xA5; 32],
        e_blinding: vec![0xA6; 32],
        ipp_proof: InnerProductProof {
            l_vec: vec![vec![0xB0; 32]],
            r_vec: vec![vec![0xB1; 32]],
            a: vec![0xB2; 32],
            b: vec![0xB3; 32],
        },
    };

    BuiltTransaction {
        inputs: vec![signed_input],
        outputs: vec![output],
        fee: 400_000_000,
        tombstone_block: 1100,
        tx_prefix_hash: vec![0xFF; 32],
        range_proof,
    }
}

/// Minimal protobuf decoder for verifying encode_tx output.
fn decode_fields(buf: &[u8]) -> Vec<(u32, u32, Vec<u8>)> {
    let mut fields = Vec::new();
    let mut pos = 0;
    while pos < buf.len() {
        let (tag, new_pos) = decode_varint(buf, pos);
        pos = new_pos;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 0x7) as u32;
        match wire_type {
            0 => {
                let (val, new_pos) = decode_varint(buf, pos);
                pos = new_pos;
                fields.push((field_number, wire_type, val.to_le_bytes().to_vec()));
            }
            1 => {
                let data = buf[pos..pos + 8].to_vec();
                pos += 8;
                fields.push((field_number, wire_type, data));
            }
            2 => {
                let (len, new_pos) = decode_varint(buf, pos);
                pos = new_pos;
                let data = buf[pos..pos + len as usize].to_vec();
                pos += len as usize;
                fields.push((field_number, wire_type, data));
            }
            _ => panic!("unsupported wire type {wire_type}"),
        }
    }
    fields
}

fn decode_varint(buf: &[u8], mut pos: usize) -> (u64, usize) {
    let mut result: u64 = 0;
    let mut shift = 0;
    loop {
        let b = buf[pos] as u64;
        pos += 1;
        result |= (b & 0x7F) << shift;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    (result, pos)
}

fn get_varint_field(fields: &[(u32, u32, Vec<u8>)], field_num: u32) -> u64 {
    for (num, wt, data) in fields {
        if *num == field_num && *wt == 0 {
            return u64::from_le_bytes(data[..8].try_into().unwrap());
        }
    }
    0
}

fn get_submessages(fields: &[(u32, u32, Vec<u8>)], field_num: u32) -> Vec<Vec<u8>> {
    fields
        .iter()
        .filter(|(num, wt, _)| *num == field_num && *wt == 2)
        .map(|(_, _, data)| data.clone())
        .collect()
}

#[test]
fn test_encode_tx_structure() {
    let tx = make_test_tx();
    let encoded = encode_tx(&tx);

    let top = decode_fields(&encoded);
    let prefixes = get_submessages(&top, 1);
    let signatures = get_submessages(&top, 2);
    assert_eq!(prefixes.len(), 1, "expected 1 TxPrefix");
    assert_eq!(signatures.len(), 1, "expected 1 signature");

    let prefix_fields = decode_fields(&prefixes[0]);
    let inputs = get_submessages(&prefix_fields, 1);
    let outputs = get_submessages(&prefix_fields, 2);
    let fee = get_varint_field(&prefix_fields, 3);
    let tombstone = get_varint_field(&prefix_fields, 4);

    assert_eq!(inputs.len(), 1, "expected 1 TxIn");
    assert_eq!(outputs.len(), 1, "expected 1 TxOut");
    assert_eq!(fee, 400_000_000);
    assert_eq!(tombstone, 1100);

    let tx_in_fields = decode_fields(&inputs[0]);
    let ring_txouts = get_submessages(&tx_in_fields, 1);
    let ring_proofs = get_submessages(&tx_in_fields, 2);
    assert_eq!(ring_txouts.len(), 1, "expected 1 ring TxOut");
    assert_eq!(ring_proofs.len(), 1, "expected 1 ring proof");
    assert_eq!(ring_txouts[0], vec![0x0A, 0x04, 0x01, 0x02, 0x03, 0x04]);
    assert_eq!(ring_proofs[0], vec![0x12, 0x03, 0x05, 0x06, 0x07]);

    let tx_out_fields = decode_fields(&outputs[0]);
    assert!(
        get_submessages(&tx_out_fields, 6).len() == 1,
        "expected masked_amount_v2"
    );
    assert!(
        get_submessages(&tx_out_fields, 2).len() == 1,
        "expected target_key"
    );
    assert!(
        get_submessages(&tx_out_fields, 3).len() == 1,
        "expected public_key"
    );
    assert!(
        get_submessages(&tx_out_fields, 4).len() == 1,
        "expected e_fog_hint"
    );
    assert!(
        get_submessages(&tx_out_fields, 5).len() == 1,
        "expected e_memo"
    );

    let sig_fields = decode_fields(&signatures[0]);
    let ring_sigs = get_submessages(&sig_fields, 1);
    let pseudo_outputs = get_submessages(&sig_fields, 2);
    let range_proofs = get_submessages(&sig_fields, 4);
    assert_eq!(ring_sigs.len(), 1, "expected 1 RingMLSAG");
    assert_eq!(
        pseudo_outputs.len(),
        1,
        "expected 1 pseudo_output_commitment"
    );
    assert_eq!(range_proofs.len(), 1, "expected range_proofs");

    let mlsag_fields = decode_fields(&ring_sigs[0]);
    assert_eq!(
        get_submessages(&mlsag_fields, 1).len(),
        1,
        "expected c_zero"
    );
    assert_eq!(
        get_submessages(&mlsag_fields, 2).len(),
        2,
        "expected 2 responses"
    );
    assert_eq!(
        get_submessages(&mlsag_fields, 3).len(),
        1,
        "expected key_image"
    );

    assert_eq!(range_proofs[0].len(), 352);
}

#[test]
fn test_encode_tx_out_masked_value() {
    let output = BuiltTxOut {
        target_key: vec![0x01; 32],
        public_key: vec![0x02; 32],
        masked_value: 0xDEADBEEF_CAFEBABE,
        masked_token_id: vec![0x03; 8],
        commitment: vec![0x04; 32],
        e_fog_hint: vec![0x05; 128],
        e_memo: vec![0x07; 66],
        blinding: vec![0x06; 32],
        value: 0,
    };
    let encoded = encode_tx_out(&output);
    let fields = decode_fields(&encoded);

    let masked_amount_data = get_submessages(&fields, 6);
    assert_eq!(masked_amount_data.len(), 1);

    let ma_fields = decode_fields(&masked_amount_data[0]);
    let fixed64_fields: Vec<_> = ma_fields
        .iter()
        .filter(|(num, wt, _)| *num == 2 && *wt == 1)
        .collect();
    assert_eq!(fixed64_fields.len(), 1);
    let val = u64::from_le_bytes(fixed64_fields[0].2[..8].try_into().unwrap());
    assert_eq!(val, 0xDEADBEEF_CAFEBABE);
}

#[test]
fn test_build_tx_out_round_trip_scan() {
    let a = Scalar::from_bytes_mod_order([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 0,
    ]);
    let b = Scalar::from_bytes_mod_order([
        31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9,
        8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);

    let hs_0 = {
        let mut hasher = Blake2b512::new();
        hasher.update(b"mc_subaddress");
        hasher.update(a.as_bytes());
        hasher.update(Scalar::from(0u64).as_bytes());
        Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
    };
    let d_0_scalar = hs_0 + b;
    let d_0 = (d_0_scalar * RISTRETTO_BASEPOINT_POINT).compress();
    let c_0 = (a * d_0.decompress().unwrap()).compress();

    let recipient = Recipient {
        view_public_key: c_0.as_bytes().to_vec(),
        spend_public_key: d_0.as_bytes().to_vec(),
        fog_report_url: String::new(),
    };

    let (tx_out, _shared_secret) =
        build_tx_out_inner(&recipient, 1_000_000_000, 0, None, None, None)
            .expect("build_tx_out_inner should succeed");

    // Simulate scanning: shared_secret = a * R
    let r_point = CompressedRistretto::from_slice(&tx_out.public_key)
        .unwrap()
        .decompress()
        .unwrap();
    let shared_secret = (a * r_point).compress();

    let hs = {
        let mut hasher = Blake2b512::new();
        hasher.update(b"mc_onetime_key_hash_to_scalar");
        hasher.update(shared_secret.as_bytes());
        Scalar::from_bytes_mod_order_wide(&hasher.finalize().into())
    };

    // candidate_D = target_key - hs*G
    let target = CompressedRistretto::from_slice(&tx_out.target_key)
        .unwrap()
        .decompress()
        .unwrap();
    let candidate_d = (target - hs * RISTRETTO_BASEPOINT_POINT).compress();

    assert_eq!(
        candidate_d, d_0,
        "Scanner must recover recipient's spend public key D_0 from the TxOut"
    );

    // Verify amount can be unmasked
    let mut amount_hasher = Blake2b512::new();
    amount_hasher.update(b"mc_amount_shared_secret");
    amount_hasher.update(shared_secret.as_bytes());
    let amount_hash = amount_hasher.finalize();
    let amount_shared_secret = &amount_hash[..32];

    let hk = Hkdf::<Sha512>::new(Some(b"mc_amount_blinding_factors"), amount_shared_secret);
    let mut value_mask = [0u8; 8];
    hk.expand(b"mc_amount_value", &mut value_mask).unwrap();
    let unmasked_value = tx_out.masked_value ^ u64::from_le_bytes(value_mask);
    assert_eq!(
        unmasked_value, 1_000_000_000,
        "Scanner must recover correct amount"
    );
}

#[test]
fn test_encode_tx_empty_fog_hint_omitted() {
    let output = BuiltTxOut {
        target_key: vec![0x01; 32],
        public_key: vec![0x02; 32],
        masked_value: 100,
        masked_token_id: vec![],
        commitment: vec![0x04; 32],
        e_fog_hint: vec![],
        e_memo: vec![],
        blinding: vec![0x06; 32],
        value: 0,
    };
    let encoded = encode_tx_out(&output);
    let fields = decode_fields(&encoded);

    assert_eq!(
        get_submessages(&fields, 4).len(),
        0,
        "empty e_fog_hint should be omitted"
    );
}

#[test]
fn test_memo_round_trip_authenticated_sender() {
    let sender_a = Scalar::from_bytes_mod_order([
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
        33, 34, 35, 36, 37, 38, 39, 40, 0,
    ]);
    let sender_b = Scalar::from_bytes_mod_order([
        40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18,
        17, 16, 15, 14, 13, 12, 11, 10, 0,
    ]);

    let recip_a = Scalar::from_bytes_mod_order([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 0,
    ]);
    let recip_b = Scalar::from_bytes_mod_order([
        31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9,
        8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);

    let recip_hs_0 = {
        let mut h = Blake2b512::new();
        h.update(b"mc_subaddress");
        h.update(recip_a.as_bytes());
        h.update(Scalar::from(0u64).as_bytes());
        Scalar::from_bytes_mod_order_wide(&h.finalize().into())
    };
    let recip_d_0 = ((recip_hs_0 + recip_b) * RISTRETTO_BASEPOINT_POINT).compress();
    let recip_c_0 = (recip_a * recip_d_0.decompress().unwrap()).compress();

    let recipient = Recipient {
        view_public_key: recip_c_0.as_bytes().to_vec(),
        spend_public_key: recip_d_0.as_bytes().to_vec(),
        fog_report_url: String::new(),
    };

    let sender_hs_0 = {
        let mut h = Blake2b512::new();
        h.update(b"mc_subaddress");
        h.update(sender_a.as_bytes());
        h.update(Scalar::from(0u64).as_bytes());
        Scalar::from_bytes_mod_order_wide(&h.finalize().into())
    };
    let sender_d_0 = ((sender_hs_0 + sender_b) * RISTRETTO_BASEPOINT_POINT).compress();
    let sender_c_0 = (sender_a * sender_d_0.decompress().unwrap()).compress();
    let sender_addr_hash = compute_address_hash(sender_c_0.as_bytes(), sender_d_0.as_bytes());

    let payment_request_id: u64 = 0xDEADBEEF_CAFE1234;
    let memo = build_authenticated_sender_memo(
        &sender_b,
        &sender_addr_hash,
        &recipient,
        payment_request_id,
    )
    .expect("memo construction should succeed");

    let (tx_out, shared_secret) =
        build_tx_out_inner(&recipient, 500_000_000, 0, None, None, Some(&memo))
            .expect("build_tx_out_inner should succeed");

    // Decrypt the memo
    let memo_hk = Hkdf::<Sha512>::new(Some(MEMO_KEY_SALT), shared_secret.as_bytes());
    let mut memo_key = vec![0u8; MEMO_DATA_LEN];
    memo_hk.expand(b"", &mut memo_key).unwrap();
    let mut decrypted = [0u8; MEMO_DATA_LEN];
    for i in 0..MEMO_DATA_LEN {
        decrypted[i] = tx_out.e_memo[i] ^ memo_key[i];
    }

    assert_eq!(decrypted[0..2], MEMO_TYPE_AUTH_SENDER_WITH_PAYMENT_REQUEST);
    assert_eq!(&decrypted[2..18], &sender_addr_hash);

    let recovered_id = u64::from_le_bytes(decrypted[18..26].try_into().unwrap());
    assert_eq!(recovered_id, payment_request_id);

    assert_ne!(&decrypted[58..66], &[0u8; 8], "HMAC must not be all zeros");

    // Verify HMAC
    {
        use hmac::{Hmac, Mac};
        let ecdh = (sender_b * recip_c_0.decompress().unwrap()).compress();
        let mut key_mac = <Hmac<Sha512>>::new_from_slice(ecdh.as_bytes()).unwrap();
        key_mac.update(SENDER_MEMO_CREDENTIAL_DOMAIN);
        let hmac_key = key_mac.finalize().into_bytes();
        let mut mac = <Hmac<Sha512>>::new_from_slice(&hmac_key).unwrap();
        mac.update(recip_d_0.as_bytes());
        let expected: [u8; 8] = mac.finalize().into_bytes()[..8].try_into().unwrap();
        assert_eq!(
            &decrypted[58..66],
            &expected,
            "HMAC must match recomputed value"
        );
    }
}

#[test]
fn test_destination_memo() {
    let addr_hash = [0xAB; 16];
    let fee = 400_000_000u64;
    let total_outlay = 1_400_000_000u64;
    let memo = build_destination_memo(&addr_hash, fee, total_outlay);

    assert_eq!(memo[0..2], MEMO_TYPE_DESTINATION);
    assert_eq!(&memo[2..18], &addr_hash);
    assert_eq!(memo[18], 1);
    assert_eq!(u64::from_le_bytes(memo[19..27].try_into().unwrap()), fee);
    assert_eq!(
        u64::from_le_bytes(memo[27..35].try_into().unwrap()),
        total_outlay
    );
}

#[test]
fn test_confirmation_number() {
    let shared_secret = CompressedRistretto::from_slice(&[0x42u8; 32]).unwrap();
    let tx_out_pub = vec![0x77u8; 32];

    let cn1 = compute_confirmation_number(&shared_secret, &tx_out_pub);
    let cn2 = compute_confirmation_number(&shared_secret, &tx_out_pub);
    assert_eq!(cn1.len(), 32);
    assert_eq!(cn1, cn2, "confirmation number must be deterministic");
    assert_ne!(
        cn1,
        vec![0u8; 32],
        "confirmation number must not be all zeros"
    );

    let cn3 = compute_confirmation_number(&shared_secret, &vec![0x88u8; 32]);
    assert_ne!(cn1, cn3);
}

#[test]
fn test_default_memo_backwards_compat() {
    let a = Scalar::from_bytes_mod_order([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 0,
    ]);
    let b = Scalar::from_bytes_mod_order([
        31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9,
        8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
    let hs_0 = {
        let mut h = Blake2b512::new();
        h.update(b"mc_subaddress");
        h.update(a.as_bytes());
        h.update(Scalar::from(0u64).as_bytes());
        Scalar::from_bytes_mod_order_wide(&h.finalize().into())
    };
    let d_0 = ((hs_0 + b) * RISTRETTO_BASEPOINT_POINT).compress();
    let c_0 = (a * d_0.decompress().unwrap()).compress();

    let recipient = Recipient {
        view_public_key: c_0.as_bytes().to_vec(),
        spend_public_key: d_0.as_bytes().to_vec(),
        fog_report_url: String::new(),
    };

    let (tx_out, shared_secret) = build_tx_out_inner(&recipient, 1_000_000, 0, None, None, None)
        .expect("build should succeed");

    // Decrypt — should be all zeros
    let memo_hk = Hkdf::<Sha512>::new(Some(MEMO_KEY_SALT), shared_secret.as_bytes());
    let mut memo_key = vec![0u8; MEMO_DATA_LEN];
    memo_hk.expand(b"", &mut memo_key).unwrap();
    let mut decrypted = [0u8; MEMO_DATA_LEN];
    for i in 0..MEMO_DATA_LEN {
        decrypted[i] = tx_out.e_memo[i] ^ memo_key[i];
    }
    assert_eq!(
        decrypted, [0u8; MEMO_DATA_LEN],
        "default memo must be all zeros"
    );
}

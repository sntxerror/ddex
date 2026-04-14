//! Tests for Signed Contingent Input (SCI) functionality

use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::scalar::Scalar;

use crate::sci::{decode_tx_out, encode_tx_out, InputRules, SignedContingentInput, UnmaskedAmount};
use crate::transaction::{
    build_tx_out_inner, random_scalar, token_generator, Recipient, RingMember, TOKEN_ID_MOB,
};

/// Helper to create a test recipient
fn make_test_recipient(id: u64) -> Recipient {
    let view_pub = (Scalar::from(id) * RISTRETTO_BASEPOINT_POINT).compress();
    let spend_pub = (Scalar::from(id + 1000) * RISTRETTO_BASEPOINT_POINT).compress();

    Recipient {
        view_public_key: view_pub.as_bytes().to_vec(),
        spend_public_key: spend_pub.as_bytes().to_vec(),
        fog_report_url: String::new(), // No fog for tests
    }
}

/// Helper to create a test ring member
fn make_test_ring_member(value: u64, token_id: u64, blinding: &Scalar) -> RingMember {
    let h_token = token_generator(token_id);
    let commitment =
        (Scalar::from(value) * h_token + blinding * RISTRETTO_BASEPOINT_POINT).compress();

    RingMember {
        target_key: vec![0xAA; 32],
        public_key: vec![0xBB; 32],
        commitment: commitment.as_bytes().to_vec(),
        tx_out_bytes: vec![],
        proof_bytes: vec![],
    }
}

#[test]
fn test_encode_decode_tx_out() {
    // Create a test output
    let recipient = make_test_recipient(1);
    let (output, _shared_secret) = build_tx_out_inner(
        &recipient,
        100_000_000, // 100 MOB
        TOKEN_ID_MOB,
        None, // no fog
        None, // no fog view key
        None, // no memo
    )
    .expect("build_tx_out_inner failed");

    // Encode it
    let encoded = encode_tx_out(&output);

    // Decode it
    let decoded = decode_tx_out(&encoded).expect("decode_tx_out failed");

    // Verify key fields match
    assert_eq!(decoded.target_key, output.target_key);
    assert_eq!(decoded.public_key, output.public_key);
    assert_eq!(decoded.commitment, output.commitment);
    assert_eq!(decoded.masked_value, output.masked_value);
    assert_eq!(decoded.masked_token_id, output.masked_token_id);
}

#[test]
fn test_create_sci_structure() {
    // Test that we can create a SignedContingentInput structure
    let blinding = random_scalar();
    let value = 100_000_000u64; // 100 MOB

    // Create ring member
    let ring_member = make_test_ring_member(value, TOKEN_ID_MOB, &blinding);

    // Create required output
    let recipient = make_test_recipient(42);
    let (required_output, _) = build_tx_out_inner(
        &recipient,
        value - 10_000_000, // 90 MOB (leaving 10 MOB for fee)
        TOKEN_ID_MOB,
        None,
        None,
        None,
    )
    .expect("build_tx_out_inner failed");

    // Create pseudo-output blinding
    let pseudo_blinding = random_scalar();

    // Create a mock MLSAG signature
    let mlsag = crate::transaction::RingMLSAG {
        c_zero: vec![0x11; 32],
        responses: vec![vec![0x22; 32], vec![0x33; 32]],
        key_image: vec![0x44; 32],
    };

    // Build the SCI
    let sci = SignedContingentInput {
        block_version: 3,
        ring: vec![ring_member],
        input_rules: Some(InputRules {
            required_outputs: vec![encode_tx_out(&required_output)],
            max_tombstone_block: 1000,
            partial_fill_outputs: Vec::new(),
            partial_fill_change: None,
            min_partial_fill_value: 0,
        }),
        mlsag,
        pseudo_output_unmasked: UnmaskedAmount {
            value,
            token_id: TOKEN_ID_MOB,
            blinding: pseudo_blinding.as_bytes().to_vec(),
        },
        required_outputs_unmasked: vec![UnmaskedAmount {
            value: required_output.value,
            token_id: TOKEN_ID_MOB,
            blinding: required_output.blinding.clone(),
        }],
        tx_out_global_indices: vec![0],
    };

    // Verify SCI structure
    assert_eq!(sci.ring.len(), 1);
    assert!(sci.input_rules.is_some());
    assert_eq!(sci.pseudo_output_unmasked.value, value);
    assert_eq!(sci.required_outputs_unmasked.len(), 1);

    // Verify we can decode the required output
    let input_rules = sci.input_rules.as_ref().unwrap();
    assert_eq!(input_rules.required_outputs.len(), 1);

    let decoded_output =
        decode_tx_out(&input_rules.required_outputs[0]).expect("Failed to decode required output");
    assert_eq!(decoded_output.target_key, required_output.target_key);
    assert_eq!(decoded_output.public_key, required_output.public_key);
}

#[test]
fn test_two_sci_structure_for_swap() {
    // Test creating two SCIs for an atomic swap scenario

    // Alice's side: offering 100 MOB
    let alice_blinding = random_scalar();
    let alice_value = 100_000_000u64;
    let alice_ring = make_test_ring_member(alice_value, TOKEN_ID_MOB, &alice_blinding);

    // Bob's side: offering 50 MOB
    let bob_blinding = random_scalar();
    let bob_value = 50_000_000u64;
    let bob_ring = make_test_ring_member(bob_value, TOKEN_ID_MOB, &bob_blinding);

    // Alice wants to receive 50 MOB from Bob (minus fee)
    let alice_recipient = make_test_recipient(100);
    let (alice_output, _) = build_tx_out_inner(
        &alice_recipient,
        bob_value - 5_000_000, // 45 MOB (Bob pays 5 MOB of fee)
        TOKEN_ID_MOB,
        None,
        None,
        None,
    )
    .expect("build alice output failed");

    // Bob wants to receive 100 MOB from Alice (minus fee)
    let bob_recipient = make_test_recipient(200);
    let (bob_output, _) = build_tx_out_inner(
        &bob_recipient,
        alice_value - 5_000_000, // 95 MOB (Alice pays 5 MOB of fee)
        TOKEN_ID_MOB,
        None,
        None,
        None,
    )
    .expect("build bob output failed");

    let alice_pseudo_blinding = random_scalar();
    let bob_pseudo_blinding = random_scalar();

    // Mock MLSAG signatures
    let alice_mlsag = crate::transaction::RingMLSAG {
        c_zero: vec![0xA1; 32],
        responses: vec![vec![0xA2; 32], vec![0xA3; 32]],
        key_image: vec![0xA4; 32],
    };

    let bob_mlsag = crate::transaction::RingMLSAG {
        c_zero: vec![0xB1; 32],
        responses: vec![vec![0xB2; 32], vec![0xB3; 32]],
        key_image: vec![0xB4; 32],
    };

    // Alice's SCI: "I'll give 100 MOB if I receive the output with 45 MOB"
    let alice_sci = SignedContingentInput {
        block_version: 3,
        ring: vec![alice_ring],
        input_rules: Some(InputRules {
            required_outputs: vec![encode_tx_out(&alice_output)],
            max_tombstone_block: 2000,
            partial_fill_outputs: Vec::new(),
            partial_fill_change: None,
            min_partial_fill_value: 0,
        }),
        mlsag: alice_mlsag,
        pseudo_output_unmasked: UnmaskedAmount {
            value: alice_value,
            token_id: TOKEN_ID_MOB,
            blinding: alice_pseudo_blinding.as_bytes().to_vec(),
        },
        required_outputs_unmasked: vec![UnmaskedAmount {
            value: alice_output.value,
            token_id: TOKEN_ID_MOB,
            blinding: alice_output.blinding.clone(),
        }],
        tx_out_global_indices: vec![0],
    };

    // Bob's SCI: "I'll give 50 MOB if I receive the output with 95 MOB"
    let bob_sci = SignedContingentInput {
        block_version: 3,
        ring: vec![bob_ring],
        input_rules: Some(InputRules {
            required_outputs: vec![encode_tx_out(&bob_output)],
            max_tombstone_block: 2000,
            partial_fill_outputs: Vec::new(),
            partial_fill_change: None,
            min_partial_fill_value: 0,
        }),
        mlsag: bob_mlsag,
        pseudo_output_unmasked: UnmaskedAmount {
            value: bob_value,
            token_id: TOKEN_ID_MOB,
            blinding: bob_pseudo_blinding.as_bytes().to_vec(),
        },
        required_outputs_unmasked: vec![UnmaskedAmount {
            value: bob_output.value,
            token_id: TOKEN_ID_MOB,
            blinding: bob_output.blinding.clone(),
        }],
        tx_out_global_indices: vec![1],
    };

    // Verify both SCIs are valid structures
    assert_eq!(alice_sci.pseudo_output_unmasked.value, alice_value);
    assert_eq!(bob_sci.pseudo_output_unmasked.value, bob_value);

    // Verify required outputs are correctly encoded
    assert_eq!(
        alice_sci
            .input_rules
            .as_ref()
            .unwrap()
            .required_outputs
            .len(),
        1
    );
    assert_eq!(
        bob_sci.input_rules.as_ref().unwrap().required_outputs.len(),
        1
    );

    // Verify the swap balance
    // Inputs: Alice gives 100 + Bob gives 50 = 150 total
    // Outputs: Alice receives 45 + Bob receives 95 = 140 total
    // Fee: 150 - 140 = 10 MOB
    let total_inputs =
        alice_sci.pseudo_output_unmasked.value + bob_sci.pseudo_output_unmasked.value;
    let total_outputs =
        alice_sci.required_outputs_unmasked[0].value + bob_sci.required_outputs_unmasked[0].value;
    assert_eq!(total_inputs - total_outputs, 10_000_000);
}

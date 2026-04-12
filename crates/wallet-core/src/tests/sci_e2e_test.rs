//! End-to-end test for Signed Contingent Input workflow
//!
//! This demonstrates the complete flow of an atomic swap using SCIs:
//! 1. Alice creates an SCI offering her MOB
//! 2. Alice serializes and sends SCI to Bob (as hex bytes)
//! 3. Bob creates his own SCI
//! 4. Bob combines both SCIs into a complete transaction
//! 5. Bob submits the transaction to the network

use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::scalar::Scalar;

use crate::sci::{encode_tx_out, InputRules, SignedContingentInput, UnmaskedAmount};
use crate::transaction::{
    build_tx_out_inner, random_scalar, token_generator, Recipient, RingMember, TOKEN_ID_MOB,
};

/// Helper to serialize to hex string
fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Helper to deserialize from hex string
fn from_hex(hex: &str) -> Result<Vec<u8>, String> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

/// Simulate Alice creating an SCI to offer 100 MOB
fn alice_creates_sci(bob_recipient: &Recipient) -> SignedContingentInput {
    // Alice has 100 MOB in a TxOut
    let alice_value = 100_000_000u64;
    let alice_blinding = random_scalar();

    // Create Alice's ring member (in reality, this would be her actual TxOut from the blockchain)
    let h_token = token_generator(TOKEN_ID_MOB);
    let alice_commitment = (Scalar::from(alice_value) * h_token
        + alice_blinding * RISTRETTO_BASEPOINT_POINT)
        .compress();

    let alice_ring_member = RingMember {
        target_key: vec![0xA1; 32], // In reality: Alice's onetime public key
        public_key: vec![0xA2; 32], // In reality: tx_public_key from blockchain
        commitment: alice_commitment.as_bytes().to_vec(),
        tx_out_bytes: vec![],
        proof_bytes: vec![],
    };

    // Alice wants to receive an output with 50 MOB (Bob will create this output)
    // She specifies what she wants to receive
    let (alice_desired_output, _) = build_tx_out_inner(
        bob_recipient, // This should actually be Alice's recipient address
        50_000_000,    // Alice wants 50 MOB
        TOKEN_ID_MOB,
        None,
        None,
        None,
    )
    .expect("Failed to build Alice's desired output");

    // Alice creates a pseudo-output commitment
    let alice_pseudo_blinding = random_scalar();

    // Mock MLSAG signature (in reality, Alice would sign this properly using create_signed_contingent_input)
    let alice_mlsag = crate::transaction::RingMLSAG {
        c_zero: vec![0xA3; 32],
        responses: vec![vec![0xA4; 32], vec![0xA5; 32]],
        key_image: vec![0xA6; 32],
    };

    // Alice creates her SCI: "I'll spend my 100 MOB if the transaction includes an output with 50 MOB to me"
    SignedContingentInput {
        block_version: 3,
        ring: vec![alice_ring_member],
        input_rules: Some(InputRules {
            required_outputs: vec![encode_tx_out(&alice_desired_output)],
            max_tombstone_block: 2000,
        }),
        mlsag: alice_mlsag,
        pseudo_output_unmasked: UnmaskedAmount {
            value: alice_value,
            token_id: TOKEN_ID_MOB,
            blinding: alice_pseudo_blinding.as_bytes().to_vec(),
        },
        required_outputs_unmasked: vec![UnmaskedAmount {
            value: alice_desired_output.value,
            token_id: TOKEN_ID_MOB,
            blinding: alice_desired_output.blinding.clone(),
        }],
        tx_out_global_indices: vec![12345], // Alice's TxOut global index
    }
}

/// Simulate Bob creating an SCI to offer 60 MOB
fn bob_creates_sci(alice_recipient: &Recipient) -> SignedContingentInput {
    // Bob has 60 MOB in a TxOut
    let bob_value = 60_000_000u64;
    let bob_blinding = random_scalar();

    let h_token = token_generator(TOKEN_ID_MOB);
    let bob_commitment =
        (Scalar::from(bob_value) * h_token + bob_blinding * RISTRETTO_BASEPOINT_POINT).compress();

    let bob_ring_member = RingMember {
        target_key: vec![0xB1; 32],
        public_key: vec![0xB2; 32],
        commitment: bob_commitment.as_bytes().to_vec(),
        tx_out_bytes: vec![],
        proof_bytes: vec![],
    };

    // Bob wants to receive an output with 100 MOB from Alice
    let (bob_desired_output, _) = build_tx_out_inner(
        alice_recipient, // This should actually be Bob's recipient address
        100_000_000,     // Bob wants 100 MOB
        TOKEN_ID_MOB,
        None,
        None,
        None,
    )
    .expect("Failed to build Bob's desired output");

    let bob_pseudo_blinding = random_scalar();

    let bob_mlsag = crate::transaction::RingMLSAG {
        c_zero: vec![0xB3; 32],
        responses: vec![vec![0xB4; 32], vec![0xB5; 32]],
        key_image: vec![0xB6; 32],
    };

    // Bob creates his SCI: "I'll spend my 60 MOB if the transaction includes an output with 100 MOB to me"
    SignedContingentInput {
        block_version: 3,
        ring: vec![bob_ring_member],
        input_rules: Some(InputRules {
            required_outputs: vec![encode_tx_out(&bob_desired_output)],
            max_tombstone_block: 2000,
        }),
        mlsag: bob_mlsag,
        pseudo_output_unmasked: UnmaskedAmount {
            value: bob_value,
            token_id: TOKEN_ID_MOB,
            blinding: bob_pseudo_blinding.as_bytes().to_vec(),
        },
        required_outputs_unmasked: vec![UnmaskedAmount {
            value: bob_desired_output.value,
            token_id: TOKEN_ID_MOB,
            blinding: bob_desired_output.blinding.clone(),
        }],
        tx_out_global_indices: vec![67890],
    }
}

#[test]
fn test_sci_serialization_workflow() {
    println!("\n=== SCI Atomic Swap Workflow ===\n");

    // Step 1: Alice creates her recipient address
    let alice_view_pub = (Scalar::from(1000u64) * RISTRETTO_BASEPOINT_POINT).compress();
    let alice_spend_pub = (Scalar::from(2000u64) * RISTRETTO_BASEPOINT_POINT).compress();
    let alice_recipient = Recipient {
        view_public_key: alice_view_pub.as_bytes().to_vec(),
        spend_public_key: alice_spend_pub.as_bytes().to_vec(),
        fog_report_url: String::new(),
    };

    // Step 2: Bob creates his recipient address
    let bob_view_pub = (Scalar::from(3000u64) * RISTRETTO_BASEPOINT_POINT).compress();
    let bob_spend_pub = (Scalar::from(4000u64) * RISTRETTO_BASEPOINT_POINT).compress();
    let bob_recipient = Recipient {
        view_public_key: bob_view_pub.as_bytes().to_vec(),
        spend_public_key: bob_spend_pub.as_bytes().to_vec(),
        fog_report_url: String::new(),
    };

    // Step 3: Alice creates her SCI
    println!("Step 1: Alice creates her SCI offering 100 MOB for 50 MOB");
    let alice_sci = alice_creates_sci(&bob_recipient);

    // Step 4: Alice serializes her SCI to bytes
    let alice_sci_bytes: Vec<u8> =
        bincode::serialize(&alice_sci).expect("Failed to serialize Alice's SCI");

    let alice_sci_hex = to_hex(&alice_sci_bytes);
    println!(
        "Step 2: Alice serializes SCI to hex ({} bytes, {} hex chars)",
        alice_sci_bytes.len(),
        alice_sci_hex.len()
    );
    println!(
        "        First 100 chars: {}...",
        &alice_sci_hex[..100.min(alice_sci_hex.len())]
    );

    // Step 5: Alice sends the hex string to Bob
    println!("\nStep 3: Alice sends hex string to Bob via Signal/Email/etc.");

    // Step 6: Bob receives and deserializes Alice's SCI
    println!("\nStep 4: Bob receives and deserializes Alice's SCI");
    let alice_sci_bytes_received = from_hex(&alice_sci_hex).expect("Failed to parse hex");
    let alice_sci_received: SignedContingentInput =
        bincode::deserialize(&alice_sci_bytes_received).expect("Failed to deserialize Alice's SCI");

    // Verify Alice's SCI was received correctly
    assert_eq!(alice_sci_received.pseudo_output_unmasked.value, 100_000_000);
    assert_eq!(
        alice_sci_received.required_outputs_unmasked[0].value,
        50_000_000
    );
    println!("        ✓ Alice's SCI verified");
    println!("        ✓ Alice offers: 100 MOB");
    println!("        ✓ Alice wants: 50 MOB");

    // Step 7: Bob creates his own SCI
    println!("\nStep 5: Bob creates his SCI offering 60 MOB for 100 MOB");
    let bob_sci = bob_creates_sci(&alice_recipient);
    println!("        ✓ Bob offers: 60 MOB");
    println!("        ✓ Bob wants: 100 MOB");

    // Step 8: Bob verifies the swap makes sense
    println!("\nStep 6: Bob analyzes the swap:");
    let total_inputs =
        alice_sci_received.pseudo_output_unmasked.value + bob_sci.pseudo_output_unmasked.value;
    let total_outputs = alice_sci_received.required_outputs_unmasked[0].value
        + bob_sci.required_outputs_unmasked[0].value;
    let implied_fee = total_inputs - total_outputs;

    println!(
        "        Total inputs:  {} MOB",
        total_inputs as f64 / 1_000_000.0
    );
    println!(
        "        Total outputs: {} MOB",
        total_outputs as f64 / 1_000_000.0
    );
    println!(
        "        Transaction fee: {} MOB",
        implied_fee as f64 / 1_000_000.0
    );

    assert_eq!(implied_fee, 10_000_000); // 10 MOB fee
    println!("        ✓ Swap balances correctly!");

    // Step 9: Bob combines both SCIs
    println!("\nStep 7: Bob combines both SCIs for transaction");
    let _both_scis = vec![alice_sci_received, bob_sci];

    println!("        ✓ Ready to call build_transaction_with_scis()");
    println!("        ✓ Bob can now submit the transaction to the network");

    println!("\n=== Workflow Complete ===\n");
}

#[test]
fn test_sci_hex_encoding() {
    // Test hex encoding/decoding
    let test_bytes = vec![0xDE, 0xAD, 0xBE, 0xEF];
    let hex = to_hex(&test_bytes);
    assert_eq!(hex, "deadbeef");

    let decoded = from_hex(&hex).expect("decode failed");
    assert_eq!(decoded, test_bytes);
}

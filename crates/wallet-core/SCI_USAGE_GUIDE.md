# Using Signed Contingent Inputs (SCIs) for Atomic Swaps

This guide shows how to use Signed Contingent Inputs to perform atomic token swaps without escrow or smart contracts.

## What is a Signed Contingent Input?

A Signed Contingent Input (SCI) is a "transaction fragment" that says: **"I'll spend this TxOut IF specific outputs appear in the final transaction."**

Key properties:
- ✅ Atomic - Either both parties get what they want, or neither does
- ✅ Non-custodial - No escrow or trusted third party needed
- ✅ Single transaction - Entire swap settles in one on-chain transaction
- ✅ Minimal rounds - Just one message from Alice to Bob

## Workflow

### Scenario: Alice wants to swap 100 MOB for 50 MOB with Bob

```
Alice has: 100 MOB
Alice wants: 50 MOB from Bob

Bob has: 60 MOB  
Bob wants: 100 MOB from Alice

Fee: 10 MOB (total)
```

### Step 1: Alice Creates Her SCI

Alice uses `create_signed_contingent_input()` to create an SCI:

```javascript
// In JavaScript/TypeScript with wasm bindings
import { create_signed_contingent_input } from './wasm_bindings';

const aliceSCI = create_signed_contingent_input(
  aliceAccountKey,          // Alice's account key (view + spend private keys)
  aliceOwnedInput,          // Alice's 100 MOB TxOut with ring
  [bobToAliceOutput],       // The output Alice wants to receive (50 MOB)
  2000,                     // max_tombstone_block
  3                         // block_version
);
```

The `aliceOwnedInput` structure looks like:
```javascript
{
  real_index: 0,              // Which ring member Alice owns
  ring: [                     // Ring of TxOuts for sender anonymity
    {
      target_key: "...",      // 32-byte onetime public key
      public_key: "...",      // 32-byte tx public key
      commitment: "...",      // 32-byte Pedersen commitment
      tx_out_bytes: "...",    // Protobuf bytes (optional)
      proof_bytes: "..."      // Membership proof bytes (optional)
    }
  ],
  subaddress_index: 0,        // Alice's subaddress index
  value: 100000000,           // 100 MOB in picoMOB
  token_id: 0                 // 0 = MOB
}
```

### Step 2: Alice Serializes and Sends Her SCI to Bob

```javascript
// Serialize to bytes
const sciBytes = bincode.serialize(aliceSCI);

// Convert to hex for transmission
const sciHex = Array.from(sciBytes)
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');

// Send via Signal, Email, QR code, etc.
await sendMessage(bob, sciHex);
```

Output:
```
Alice's SCI: 764 bytes, 1528 hex chars
0300000001000000000000002000000000000000a1a1a1a1...
```

### Step 3: Bob Receives and Validates Alice's SCI

```javascript
// Receive hex string from Alice
const aliceSciHex = await receiveMessage();

// Parse hex to bytes
const aliceSciBytes = hexToBytes(aliceSciHex);

// Deserialize
const aliceSCI = bincode.deserialize(aliceSciBytes);

// Validate the SCI
const isValid = validate_signed_contingent_input(aliceSCI);
if (!isValid) {
  throw new Error("Alice's SCI is invalid!");
}

// Check what Alice is offering and wants
console.log(`Alice offers: ${aliceSCI.pseudo_output_unmasked.value / 1e6} MOB`);
console.log(`Alice wants: ${aliceSCI.required_outputs_unmasked[0].value / 1e6} MOB`);
```

Output:
```
✓ Alice's SCI verified
✓ Alice offers: 100 MOB
✓ Alice wants: 50 MOB
```

### Step 4: Bob Creates His Own SCI

```javascript
const bobSCI = create_signed_contingent_input(
  bobAccountKey,
  bobOwnedInput,           // Bob's 60 MOB TxOut
  [aliceToBobOutput],      // The output Bob wants (100 MOB)
  2000,
  3
);
```

### Step 5: Bob Verifies the Swap Balances

```javascript
const totalInputs = aliceSCI.pseudo_output_unmasked.value + 
                    bobSCI.pseudo_output_unmasked.value;
const totalOutputs = aliceSCI.required_outputs_unmasked[0].value + 
                     bobSCI.required_outputs_unmasked[0].value;
const fee = totalInputs - totalOutputs;

console.log(`Total inputs:  ${totalInputs / 1e6} MOB`);
console.log(`Total outputs: ${totalOutputs / 1e6} MOB`);
console.log(`Fee: ${fee / 1e6} MOB`);
```

Output:
```
Total inputs:  160 MOB
Total outputs: 150 MOB
Fee: 10 MOB
✓ Swap balances correctly!
```

### Step 6: Bob Builds and Submits the Transaction

```javascript
// Combine both SCIs
const scis = [aliceSCI, bobSCI];

// Build the complete transaction
const txResult = build_transaction_with_scis(
  scis,
  null,           // No additional account key needed
  null,           // No additional inputs
  10_000_000,     // 10 MOB fee
  2000            // tombstone_block
);

// Submit to MobileCoin network
const txBytes = txResult.tx_bytes;
await submitTransaction(txBytes);
```

Output:
```
✓ Transaction built successfully
✓ Submitted to network
✓ Swap complete!
```

## Security Considerations

### For Alice (the SCI Creator)

✅ **Safe**: Alice can create and share her SCI publicly
- The SCI commits to specific required outputs
- Without those outputs, Alice's funds cannot be spent
- The MLSAG signature prevents tampering

⚠️ **Important**: 
- Set a reasonable `max_tombstone_block` to limit how long the SCI is valid
- Check that Bob's required output actually goes to you!
- The SCI reveals your TxOut amount (but not which TxOut you own due to ring anonymity)

### For Bob (the Transaction Builder)

✅ **Before building the transaction**:
1. Validate Alice's SCI with `validate_signed_contingent_input()`
2. Verify Alice's required output goes to Bob
3. Check the swap ratio is acceptable
4. Verify the total fee is reasonable
5. Check the tombstone block is in the future

⚠️ **Important**:
- Bob pays the transaction fee
- Bob must have enough additional MOB to cover the fee if needed
- The transaction will only succeed if ALL required outputs from ALL SCIs are included

## API Reference

### Creating an SCI

```javascript
create_signed_contingent_input(
  account_key: AccountKey,           // {view_private_key, spend_private_key}
  input: OwnedTxOutInput,            // The TxOut you want to spend
  required_outputs: BuiltTxOut[],    // Outputs that MUST appear in the transaction
  max_tombstone_block: number,       // Maximum block height (0 = no limit)
  block_version: number              // MobileCoin block version (currently 3)
) -> SignedContingentInput
```

### Validating an SCI

```javascript
validate_signed_contingent_input(
  sci: SignedContingentInput
) -> boolean
```

### Building a Transaction with SCIs

```javascript
build_transaction_with_scis(
  scis: SignedContingentInput[],     // Array of SCIs to combine
  account_key: AccountKey | null,    // Optional for additional inputs
  additional_inputs: OwnedTxOutInput[] | null,  // Optional regular inputs
  fee: number,                       // Transaction fee in picoMOB
  tombstone_block: number            // Max block height for transaction
) -> TxBuildResult
```

Returns:
```javascript
{
  tx_bytes: Uint8Array,              // Encoded transaction ready for submission
  tx_prefix_hash: Uint8Array,        // Hash of TxPrefix
  key_images: Uint8Array[],          // Key images from all inputs
  confirmation_number: Uint8Array    // Empty for SCI transactions
}
```

## Common Patterns

### Pattern 1: Simple Two-Party Swap

```javascript
// Alice → Bob: aliceSCI via messaging
// Bob builds and submits transaction
```

### Pattern 2: Multi-Party Swap

```javascript
// Alice, Bob, Charlie all create SCIs
// Any party can combine all SCIs and submit
const scis = [aliceSCI, bobSCI, charlieSCI];
const tx = build_transaction_with_scis(scis, null, null, fee, tombstone);
```

### Pattern 3: SCI + Regular Inputs

```javascript
// Use SCI for swap, add regular input for change
const tx = build_transaction_with_scis(
  [aliceSCI],
  bobAccountKey,          // Bob adds his own funds
  [bobAdditionalInput],   // Bob's regular input
  fee,
  tombstone
);
```

## Serialization Formats

### Hex String (Recommended for Messaging)

```javascript
// Serialize
const hex = Array.from(bincode.serialize(sci))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');

// Deserialize
const bytes = hex.match(/.{2}/g).map(b => parseInt(b, 16));
const sci = bincode.deserialize(new Uint8Array(bytes));
```

### Base64 (Recommended for URLs/QR Codes)

```javascript
// Serialize
const base64 = btoa(String.fromCharCode(...bincode.serialize(sci)));

// Deserialize  
const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
const sci = bincode.deserialize(bytes);
```

### Binary (Most Efficient)

```javascript
const bytes = bincode.serialize(sci);  // ~764 bytes for typical SCI
```

## Error Handling

Common errors and solutions:

**"Tombstone block exceeds SCI maximum"**
- Solution: Use a tombstone_block ≤ the SCI's max_tombstone_block

**"At least one SCI must be provided"**
- Solution: Pass at least one SCI to build_transaction_with_scis()

**"Additional regular inputs not yet supported"**
- Solution: Currently, you can only combine SCIs. Regular input support coming soon.

**"Non-canonical blinding scalar"**
- Solution: Ensure blinding factors are valid Curve25519 scalars

## Testing

Run the SCI tests:

```bash
# Run all SCI tests
cargo test --lib sci_tests

# Run E2E workflow test
cargo test --lib test_sci_serialization_workflow -- --nocapture

# Run specific test
cargo test --lib test_encode_decode_tx_out
```

## References

- [MCIP-0031: Transactions with Contingent Inputs](https://github.com/mobilecoinfoundation/mcips/blob/main/text/0031-transactions-with-contingent-inputs.md)
- MobileCoin Documentation
- This implementation: `/src/sci.rs`, `/src/transaction/builder.rs`

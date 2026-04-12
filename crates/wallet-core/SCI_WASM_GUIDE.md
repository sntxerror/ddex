# WASM Usage Guide for Signed Contingent Inputs (SCI)

This guide demonstrates how to use the SCI functionality from JavaScript/TypeScript via WebAssembly.

## Table of Contents

- [Setup](#setup)
- [Basic Example: Creating an SCI](#basic-example-creating-an-sci)
- [Validating a Received SCI](#validating-a-received-sci)
- [Serialization & Sharing](#serialization--sharing)
- [Combining SCIs into a Transaction](#combining-scis-into-a-transaction)
- [Complete Atomic Swap Example](#complete-atomic-swap-example)
- [Advanced: Key Image Checking](#advanced-key-image-checking)
- [Error Handling](#error-handling)

## Setup

First, build the WASM package:

```bash
wasm-pack build --target web
```

Then import in your JavaScript/TypeScript:

```typescript
import init, {
  create_signed_contingent_input,
  validate_signed_contingent_input,
  serialize_sci_to_hex,
  deserialize_sci_from_hex,
  build_transaction_with_scis,
  get_sci_key_image,
  is_sci_spendable
} from './pkg/wasm.js';

// Initialize the WASM module
await init();
```

## Basic Example: Creating an SCI

Alice wants to offer 100 MOB in exchange for receiving 50 MOB at a specific address.

```typescript
// Alice's account keys
const aliceAccountKey = {
  view_private_key: new Uint8Array(32), // Your actual keys here
  spend_private_key: new Uint8Array(32)
};

// The TxOut Alice wants to spend (with ring for privacy)
const aliceInput = {
  real_index: 0, // Index of her actual TxOut in the ring
  ring: [
    {
      target_key: Array.from(new Uint8Array(32)), // Her onetime public key
      public_key: Array.from(new Uint8Array(32)), // tx_public_key from blockchain
      commitment: Array.from(new Uint8Array(32)), // Her commitment
      tx_out_bytes: [],
      proof_bytes: []
    }
    // Additional ring members for privacy...
  ],
  subaddress_index: 0n, // She received this at subaddress 0
  value: 100_000_000, // 100 MOB in picoMOB
  token_id: 0 // 0 = MOB
};

// What Alice wants to receive (Bob will create this output)
const aliceDesiredOutput = {
  value: 50_000_000, // 50 MOB
  token_id: 0,
  target_key: Array.from(new Uint8Array(32)), // Alice's recipient address
  public_key: Array.from(new Uint8Array(32)),
  commitment: Array.from(new Uint8Array(32)),
  masked_value: 0,
  masked_token_id: [],
  e_fog_hint: [],
  e_memo: [],
  blinding: Array.from(new Uint8Array(32))
};

// Create the SCI
try {
  const aliceSCI = await create_signed_contingent_input(
    aliceAccountKey,
    aliceInput,
    [aliceDesiredOutput], // Required outputs
    2000n, // Expires at block 2000
    3 // Block version
  );
  
  console.log("SCI created successfully!");
  console.log("Ring size:", aliceSCI.ring.length);
  console.log("Value:", aliceSCI.pseudo_output_unmasked.value);
} catch (error) {
  console.error("Failed to create SCI:", error.message);
}
```

## Validating a Received SCI

Always validate SCIs received from others before using them:

```typescript
async function validateReceivedSCI(sci) {
  try {
    // Check cryptographic validity
    await validate_signed_contingent_input(sci);
    console.log("✓ SCI signature is valid");
    
    // Check if still spendable
    const spendable = await is_sci_spendable(sci);
    if (!spendable) {
      throw new Error("SCI has already been spent");
    }
    console.log("✓ SCI is still spendable");
    
    // Check expiration
    const currentBlock = await getCurrentBlockHeight(); // Your ledger API
    if (sci.input_rules?.max_tombstone_block > 0) {
      if (currentBlock >= sci.input_rules.max_tombstone_block) {
        throw new Error("SCI has expired");
      }
    }
    console.log("✓ SCI has not expired");
    
    return true;
  } catch (error) {
    console.error("SCI validation failed:", error.message);
    return false;
  }
}
```

## Serialization & Sharing

SCIs need to be shared between trading partners. Use hex encoding for text-based channels:

```typescript
// Alice serializes her SCI to share with Bob
async function shareSCI(sci) {
  // Method 1: Hex encoding (for messaging apps, QR codes, etc.)
  const hexSCI = await serialize_sci_to_hex(sci);
  console.log("Hex SCI length:", hexSCI.length, "characters"); // ~1528 chars
  console.log("Share this hex string:", hexSCI);
  
  // Send via Signal, Telegram, email, QR code, etc.
  return hexSCI;
}

// Bob receives and deserializes the hex string
async function receiveSCI(hexString) {
  try {
    const sci = await deserialize_sci_from_hex(hexString);
    
    // Always validate before using!
    const isValid = await validateReceivedSCI(sci);
    if (!isValid) {
      throw new Error("Received invalid SCI");
    }
    
    return sci;
  } catch (error) {
    console.error("Failed to deserialize SCI:", error.message);
    throw error;
  }
}

// Alternative: Binary serialization (for file storage or binary protocols)
async function saveSCIToFile(sci, filename) {
  const bytes = await serialize_sci_to_bytes(sci);
  console.log("Binary SCI size:", bytes.length, "bytes"); // ~764 bytes
  
  // Save to file or send over binary protocol
  await fs.writeFile(filename, bytes);
}

async function loadSCIFromFile(filename) {
  const bytes = await fs.readFile(filename);
  const sci = await deserialize_sci_from_bytes(bytes);
  
  await validateReceivedSCI(sci);
  return sci;
}
```

## Combining SCIs into a Transaction

Once you have multiple SCIs, combine them into a complete transaction:

```typescript
async function completeTrade(aliceSCI, bobSCI) {
  try {
    // Validate both SCIs first
    await validate_signed_contingent_input(aliceSCI);
    await validate_signed_contingent_input(bobSCI);
    
    // Check tombstone compatibility
    const aliceTombstone = aliceSCI.input_rules?.max_tombstone_block || 0;
    const bobTombstone = bobSCI.input_rules?.max_tombstone_block || 0;
    
    // Use the minimum tombstone (or a safe value)
    const tombstone = Math.min(
      aliceTombstone || Infinity,
      bobTombstone || Infinity,
      await getCurrentBlockHeight() + 100 // Safety buffer
    );
    
    // Build the complete transaction
    const result = await build_transaction_with_scis(
      [aliceSCI, bobSCI], // Combine both SCIs
      null, // No additional account needed
      null, // No additional inputs
      400n, // Transaction fee in picoMOB
      BigInt(tombstone)
    );
    
    console.log("Transaction built successfully!");
    console.log("Tx bytes length:", result.tx_bytes.length);
    console.log("Tx prefix hash:", bytesToHex(result.tx_prefix_hash));
    console.log("Key images:", result.key_images.map(bytesToHex));
    
    // Submit to network
    await submitTransaction(result.tx_bytes);
    
    return result.tx_prefix_hash;
  } catch (error) {
    console.error("Failed to complete trade:", error.message);
    throw error;
  }
}
```

## Complete Atomic Swap Example

Here's a full workflow for Alice and Bob swapping tokens:

```typescript
// ========== Alice's Side ==========

async function aliceCreateSwapOffer() {
  console.log("Alice: Creating swap offer...");
  
  // Alice wants to trade 100 MOB for Bob's 50 MOB
  const aliceSCI = await create_signed_contingent_input(
    aliceAccountKey,
    aliceInput, // Her 100 MOB TxOut
    [bobDesiredOutput], // What she wants to receive
    2000n,
    3
  );
  
  // Serialize and send to Bob
  const hexSCI = await serialize_sci_to_hex(aliceSCI);
  await sendToBob(hexSCI); // Via messaging app
  
  console.log("Alice: Sent SCI to Bob");
  return hexSCI;
}

// ========== Bob's Side ==========

async function bobAcceptSwapOffer(aliceHexSCI) {
  console.log("Bob: Received Alice's offer");
  
  // Deserialize and validate Alice's SCI
  const aliceSCI = await deserialize_sci_from_hex(aliceHexSCI);
  await validate_signed_contingent_input(aliceSCI);
  
  // Check what Alice is offering
  console.log("Alice offers:", aliceSCI.pseudo_output_unmasked.value, "picoMOB");
  
  // Check what Alice wants
  const aliceWants = aliceSCI.required_outputs_unmasked[0];
  console.log("Alice wants:", aliceWants.value, "picoMOB");
  
  // Bob creates his own SCI
  console.log("Bob: Creating matching SCI...");
  const bobSCI = await create_signed_contingent_input(
    bobAccountKey,
    bobInput, // His 50 MOB TxOut
    [aliceDesiredOutput], // What Alice wanted
    2000n,
    3
  );
  
  // Combine both SCIs into a transaction
  console.log("Bob: Building final transaction...");
  const txResult = await build_transaction_with_scis(
    [aliceSCI, bobSCI],
    null,
    null,
    400n, // Fee
    2000n // Tombstone
  );
  
  // Submit to network
  console.log("Bob: Submitting transaction to network...");
  await submitTransaction(txResult.tx_bytes);
  
  console.log("✓ Swap completed!");
  console.log("Transaction hash:", bytesToHex(txResult.tx_prefix_hash));
  
  return txResult;
}

// ========== Complete Flow ==========

async function performAtomicSwap() {
  try {
    // 1. Alice creates and sends her SCI
    const aliceHexSCI = await aliceCreateSwapOffer();
    
    // 2. Bob receives, validates, and completes the swap
    const result = await bobAcceptSwapOffer(aliceHexSCI);
    
    console.log("Atomic swap successful!");
    return result;
  } catch (error) {
    console.error("Swap failed:", error.message);
    throw error;
  }
}
```

## Advanced: Key Image Checking

Check if an SCI has been spent by querying the ledger:

```typescript
async function checkSCIStatus(sci) {
  // Extract the key image
  const keyImage = await get_sci_key_image(sci);
  console.log("Key image:", keyImage);
  
  // Query your ledger API
  const isSpent = await ledgerAPI.isKeyImageSpent(keyImage);
  
  if (isSpent) {
    console.log("⚠️  This SCI has already been spent");
    return { valid: false, reason: "already_spent" };
  }
  
  // Check expiration
  if (sci.input_rules?.max_tombstone_block > 0) {
    const currentBlock = await ledgerAPI.getCurrentBlockHeight();
    if (currentBlock >= sci.input_rules.max_tombstone_block) {
      console.log("⚠️  This SCI has expired");
      return { valid: false, reason: "expired" };
    }
  }
  
  console.log("✓ SCI is valid and spendable");
  return { valid: true };
}

// Monitor multiple SCIs
async function monitorSCIs(sciList) {
  const results = await Promise.all(
    sciList.map(async (sci) => {
      const keyImage = await get_sci_key_image(sci);
      const status = await checkSCIStatus(sci);
      return { keyImage, ...status };
    })
  );
  
  return results;
}
```

## Error Handling

Robust error handling for SCI operations:

```typescript
async function safeSCIOperation(operation, ...args) {
  try {
    return await operation(...args);
  } catch (error) {
    // Parse common error types
    if (error.message.includes("Invalid hex")) {
      console.error("Serialization error: Invalid hex encoding");
      throw new Error("INVALID_HEX");
    }
    
    if (error.message.includes("MLSAG verification failed")) {
      console.error("Validation error: Invalid signature");
      throw new Error("INVALID_SIGNATURE");
    }
    
    if (error.message.includes("Commitment verification failed")) {
      console.error("Validation error: Commitment mismatch");
      throw new Error("INVALID_COMMITMENT");
    }
    
    if (error.message.includes("already been spent")) {
      console.error("Spendability error: Key image already used");
      throw new Error("ALREADY_SPENT");
    }
    
    if (error.message.includes("Insufficient balance")) {
      console.error("Transaction error: Not enough funds");
      throw new Error("INSUFFICIENT_FUNDS");
    }
    
    // Unknown error
    console.error("Unknown error:", error);
    throw error;
  }
}

// Usage example
async function safeSwap(aliceSCI, bobSCI) {
  try {
    // Validate Alice's SCI
    await safeSCIOperation(validate_signed_contingent_input, aliceSCI);
    
    // Validate Bob's SCI
    await safeSCIOperation(validate_signed_contingent_input, bobSCI);
    
    // Build transaction
    const result = await safeSCIOperation(
      build_transaction_with_scis,
      [aliceSCI, bobSCI],
      null,
      null,
      400n,
      2000n
    );
    
    return result;
  } catch (error) {
    switch (error.message) {
      case "INVALID_SIGNATURE":
        console.log("Partner's SCI has invalid signature");
        break;
      case "ALREADY_SPENT":
        console.log("One of the inputs was already spent");
        break;
      case "INVALID_COMMITMENT":
        console.log("Commitment verification failed");
        break;
      default:
        console.log("Unexpected error:", error.message);
    }
    throw error;
  }
}
```

## Utility Functions

```typescript
// Convert bytes to hex string
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert hex string to bytes
function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return new Uint8Array(bytes);
}

// Pretty print SCI info
function printSCIInfo(sci) {
  console.log("SCI Information:");
  console.log("  Block version:", sci.block_version);
  console.log("  Ring size:", sci.ring.length);
  console.log("  Value:", sci.pseudo_output_unmasked.value, "picoMOB");
  console.log("  Token ID:", sci.pseudo_output_unmasked.token_id);
  console.log("  Required outputs:", sci.required_outputs_unmasked.length);
  
  if (sci.input_rules) {
    console.log("  Max tombstone:", sci.input_rules.max_tombstone_block);
  }
}
```

## Best Practices

1. **Always validate SCIs** before using them in transactions
2. **Check key images** against the ledger to ensure inputs haven't been spent
3. **Verify tombstone blocks** are compatible when combining SCIs
4. **Use hex encoding** for text-based channels (messaging apps, QR codes)
5. **Use binary encoding** for efficient storage and binary protocols
6. **Handle errors gracefully** with proper error messages
7. **Monitor expiration** to ensure SCIs are used before they expire
8. **Test thoroughly** with small amounts before production use

## Next Steps

- See `SCI_README.md` for technical implementation details
- See `SCI_USAGE_GUIDE.md` for Rust API documentation
- See `src/tests/sci_e2e_test.rs` for integration test examples
- Check the TypeScript definitions in `sci.d.ts` for complete type information

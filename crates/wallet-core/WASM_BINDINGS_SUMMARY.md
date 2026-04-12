# WASM Bindings Summary for SCI Implementation

## Overview

WASM bindings have been successfully added to expose the Signed Contingent Input (SCI) functionality to JavaScript/TypeScript applications. This enables browser-based and Node.js applications to perform atomic swaps using MobileCoin.

## New WASM Functions

### Core SCI Operations

#### `create_signed_contingent_input`
**Location:** `src/sci.rs:188`

Creates a Signed Contingent Input from an owned TxOut.

```typescript
function create_signed_contingent_input(
  account_key_js: AccountKey,
  input_js: OwnedSCIInput,
  required_outputs_js: BuiltTxOut[],
  max_tombstone_block: bigint,
  block_version: number
): Promise<SignedContingentInput>
```

#### `validate_signed_contingent_input`
**Location:** `src/sci.rs:372`

Validates a received SCI by checking MLSAG signatures and commitments.

```typescript
function validate_signed_contingent_input(
  sci_js: SignedContingentInput
): Promise<void>
```

#### `is_sci_spendable`
**Location:** `src/sci.rs:427`

Checks if an SCI's key image has been spent (placeholder implementation).

```typescript
function is_sci_spendable(
  sci_js: SignedContingentInput
): Promise<boolean>
```

#### `build_transaction_with_scis`
**Location:** `src/transaction/builder.rs:595`

Combines multiple SCIs into a complete transaction.

```typescript
function build_transaction_with_scis(
  scis_js: SignedContingentInput[],
  account_key_js: AccountKey | null,
  additional_inputs_js: any[] | null,
  fee: bigint,
  tombstone_block: bigint
): Promise<TxBuildResult>
```

### Serialization Functions (NEW)

#### `serialize_sci_to_hex`
**Location:** `src/sci.rs:909`

Serializes an SCI to a hex string for text-based transmission.

```typescript
function serialize_sci_to_hex(
  sci_js: SignedContingentInput
): Promise<string>
```

**Size:** ~1528 hex characters (~764 bytes binary)

#### `deserialize_sci_from_hex`
**Location:** `src/sci.rs:950`

Deserializes an SCI from a hex string.

```typescript
function deserialize_sci_from_hex(
  hex: string
): Promise<SignedContingentInput>
```

#### `serialize_sci_to_bytes`
**Location:** `src/sci.rs:1016`

Serializes an SCI to raw binary bytes.

```typescript
function serialize_sci_to_bytes(
  sci_js: SignedContingentInput
): Promise<Uint8Array>
```

**Size:** ~764 bytes

#### `deserialize_sci_from_bytes`
**Location:** `src/sci.rs:1034`

Deserializes an SCI from raw binary bytes.

```typescript
function deserialize_sci_from_bytes(
  bytes: Uint8Array
): Promise<SignedContingentInput>
```

### Utility Functions (NEW)

#### `get_sci_key_image`
**Location:** `src/sci.rs:985`

Extracts the key image from an SCI for ledger queries.

```typescript
function get_sci_key_image(
  sci_js: SignedContingentInput
): Promise<string>
```

**Returns:** 64-character hex string (32 bytes)

## Documentation Files

### 1. `sci.d.ts`
TypeScript type definitions with complete interface documentation.

**Location:** `/Users/kif/dev/dreamers/lopenexus/ddex/crates/wallet-core/sci.d.ts`

Includes:
- All data structure interfaces (SignedContingentInput, RingMember, etc.)
- Complete function signatures with JSDoc comments
- Usage examples for each function

### 2. `SCI_WASM_GUIDE.md`
Comprehensive guide for using SCI via WASM in JavaScript/TypeScript.

**Location:** `/Users/kif/dev/dreamers/lopenexus/ddex/crates/wallet-core/SCI_WASM_GUIDE.md`

Includes:
- Setup instructions
- Complete atomic swap example
- Serialization patterns
- Error handling
- Best practices

### 3. Generated Types
Auto-generated TypeScript definitions from wasm-bindgen.

**Location:** `/Users/kif/dev/dreamers/lopenexus/ddex/crates/wallet-core/pkg/wasm.d.ts`

Updated automatically on each build with `wasm-pack build --target web`

## Build Instructions

### Build WASM Package

```bash
cd /Users/kif/dev/dreamers/lopenexus/ddex/crates/wallet-core
wasm-pack build --target web --out-dir pkg
```

This generates:
- `pkg/wasm.js` - JavaScript bindings
- `pkg/wasm.d.ts` - TypeScript definitions
- `pkg/wasm_bg.wasm` - WebAssembly binary

### Import in JavaScript/TypeScript

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

// Initialize WASM module
await init();
```

## Testing

### Rust Tests
All SCI tests pass:

```bash
cargo test --lib sci
```

Results: 5/5 tests passing
- `test_encode_decode_tx_out`
- `test_create_sci_structure`
- `test_two_sci_structure_for_swap`
- `test_sci_serialization_workflow`
- `test_sci_hex_encoding`

### WASM Build
Build successful with all functions exported:

```bash
wasm-pack build --target web
```

All 9 SCI functions successfully exported to WASM.

## Usage Example

Complete atomic swap in JavaScript:

```typescript
// 1. Alice creates SCI
const aliceSCI = await create_signed_contingent_input(
  aliceAccountKey,
  aliceInput,
  [requiredOutput],
  2000n,
  3
);

// 2. Alice serializes and sends to Bob
const hexSCI = await serialize_sci_to_hex(aliceSCI);
sendToBob(hexSCI);

// 3. Bob receives and validates
const receivedSCI = await deserialize_sci_from_hex(hexSCI);
await validate_signed_contingent_input(receivedSCI);

// 4. Bob creates his SCI
const bobSCI = await create_signed_contingent_input(
  bobAccountKey,
  bobInput,
  [bobRequiredOutput],
  2000n,
  3
);

// 5. Bob combines and submits
const result = await build_transaction_with_scis(
  [receivedSCI, bobSCI],
  null,
  null,
  400n,
  2000n
);

submitToNetwork(result.tx_bytes);
```

## Key Features

1. **Serialization Flexibility**
   - Hex encoding for text channels (messaging apps, QR codes)
   - Binary encoding for efficient storage
   - Automatic bincode serialization

2. **Type Safety**
   - Complete TypeScript definitions
   - JSDoc comments with examples
   - Strong typing for all interfaces

3. **Error Handling**
   - Detailed error messages
   - Validation at every step
   - Clear failure modes

4. **Developer Experience**
   - Comprehensive documentation
   - Working code examples
   - Best practices guide

## Dependencies

WASM bindings use:
- `wasm-bindgen` for Rust ↔ JavaScript interop
- `serde-wasm-bindgen` for data serialization
- `bincode` for efficient binary encoding
- Auto-generated TypeScript types

## Performance

Typical sizes:
- Binary SCI: ~764 bytes
- Hex SCI: ~1528 characters
- WASM binary: ~833 KB (optimized)

## Next Steps

To use in production:
1. Build WASM package: `wasm-pack build --target web`
2. Import functions in your JavaScript/TypeScript app
3. Initialize WASM module with `await init()`
4. Follow examples in `SCI_WASM_GUIDE.md`

## References

- **MCIP-0031:** https://github.com/mobilecoinfoundation/mcips/blob/main/text/0031-transactions-with-contingent-inputs.md
- **SCI Implementation:** `src/sci.rs`
- **Transaction Builder:** `src/transaction/builder.rs`
- **Rust Documentation:** `SCI_README.md`, `SCI_USAGE_GUIDE.md`
- **WASM Guide:** `SCI_WASM_GUIDE.md`
- **TypeScript Types:** `sci.d.ts`, `pkg/wasm.d.ts`

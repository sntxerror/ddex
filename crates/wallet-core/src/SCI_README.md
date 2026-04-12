# Signed Contingent Input (SCI) Implementation

This module implements MCIP-0031: Transactions with Contingent Inputs for MobileCoin.

Reference: https://github.com/mobilecoinfoundation/mcips/blob/main/text/0031-transactions-with-contingent-inputs.md

## Overview

A Signed Contingent Input allows users to create "transaction fragments" that can be safely sent to other users. This enables atomic swaps without smart contracts or escrow.

### Key Features

- **Atomic swaps**: Trade tokens in a single on-chain transaction
- **No custody transfer**: Funds never leave your control until the trade executes
- **Minimal interaction**: Only one message needs to be sent
- **No smart contracts**: Works with the existing transaction format

## Core Concepts

### SignedContingentInput

A SCI represents a request to trade "this for that":
- **This**: Your TxOut (input you're willing to spend)
- **That**: Required outputs that must appear in the final transaction

The MLSAG signature commits to the InputRules, making them tamper-proof.

### InputRules

Rules that must be satisfied by any transaction using this input:
- `required_outputs`: TxOuts that must appear in the transaction
- `max_tombstone_block`: Optional time-to-live for the swap offer

### UnmaskedAmount

Plaintext data underlying a Pedersen commitment:
- `value`: Amount in picoMOB
- `token_id`: Token type (0 = MOB)
- `blinding`: Blinding factor (32-byte scalar)

Recipients need this to:
1. Verify commitments match
2. Build range proofs
3. Prove the transaction is balanced

## API Functions

### `create_signed_contingent_input()`

Create a SCI from an owned TxOut.

**Arguments:**
- `account_key_js`: Your account key (to derive the onetime private key)
- `input_js`: The TxOut you want to spend (with ring)
- `required_outputs_js`: TxOuts that must appear in the transaction
- `max_tombstone_block`: Optional time-to-live for this swap offer
- `block_version`: Block version to use (typically 3)

**Returns:** A SignedContingentInput that can be sent to potential trading partners

**Example use case:**
```javascript
// You want to buy 100 EUSD for 5 MOB
const sci = await create_signed_contingent_input(
    myAccountKey,
    myMobInput,      // Your 5 MOB TxOut
    [eusdOutput],    // Required output: 100 EUSD to your address
    tombstoneBlock,
    3
);
// Send the SCI to a potential counterparty
```

### `validate_signed_contingent_input()`

Validate a SCI before using it in a transaction.

**Checks:**
1. Each unmasked required output matches its commitment
2. The MLSAG signature is valid over the TxIn digest
3. The pseudo-output commitment matches its unmasked amount

**Returns:** Ok(()) if valid, Err with details if invalid

### `is_sci_spendable()`

Check if a SCI is still spendable.

**Returns:** true if the key image has not appeared in the ledger yet

(Note: Currently returns a placeholder value. In a full implementation, this would query the ledger.)

## Implementation Details

### MLSAG Signing for SCI

When there are contingent input rules, the MLSAG signs over the digest of the TxIn (including the rules) rather than the full TxPrefix extended message digest. This allows:

1. One party to sign a contingent input without knowing the final transaction
2. Another party to complete the transaction by adding their inputs/outputs
3. Both parties' funds to be protected by cryptographic signatures

### Message to Sign

For contingent inputs, the message is:
```
Hash(TxIn { ring, input_rules })
```

For regular inputs (no rules), the message is:
```
Hash(TxPrefix { inputs, outputs, fee, tombstone_block })
```

This ensures that:
- Contingent input rules cannot be tampered with (signed over)
- Regular inputs sign over the complete transaction (existing behavior)
- At least one regular input must exist to prevent malleability

## Use Cases

### 1. Token Swaps

Trade MOB for another token (or vice versa) atomically:
1. Alice creates a SCI: "I'll give you 5 MOB if you give me 100 EUSD"
2. Alice sends the SCI to Bob
3. Bob builds a transaction that includes:
   - Alice's SCI (spending her 5 MOB)
   - Bob's input (spending his 100 EUSD)
   - Required output to Alice (100 EUSD)
   - Change output to Bob
4. Bob submits the transaction
5. Trade executes atomically or not at all

### 2. Decentralized Exchange Order Book

A DEX can collect SCIs as "limit orders":
1. Users create SCIs with their desired swap prices
2. DEX broadcasts these to potential counterparties
3. Counterparties can check `is_sci_spendable()` to see if the order is still valid
4. When a match is found, build and submit the transaction

### 3. Payment Channels

While not fully implemented here, SCIs could be extended to support:
- Hash-locked contingent inputs (similar to Bitcoin HTLCs)
- Multi-party payment channels
- Cross-chain atomic swaps

## Security Considerations

### What's Protected

- ✅ Your funds cannot be spent without producing the required outputs
- ✅ The required outputs cannot be modified (signed over by MLSAG)
- ✅ The counterparty cannot learn your public address
- ✅ No on-chain record of the swap proposal (only the final transaction)

### What's Revealed

- ⚠️ Token types and values being traded (necessary for balance proofs)
- ⚠️ The fact that a swap occurred (visible in the final transaction)

### Important Notes

1. **Key image visibility**: Once you create a SCI, the key image is included. Anyone with the SCI can check if it's been spent.

2. **No pending state**: There's no "pending" swap state. Either the transaction executes atomically or it doesn't.

3. **Tombstone block limits**: Use `max_tombstone_block` to set a time-to-live on your swap offer. After this block, the SCI cannot be used.

4. **Cancel a swap**: Spend the input yourself in a regular transaction. This burns the key image and invalidates all SCIs using that input.

## Future Extensions

The current implementation supports single-token swaps. MCIP-0031 also describes:

1. **Multi-asset transfers**: A single transaction with inputs/outputs of multiple token types
2. **Token ID annotations**: Label inputs and outputs with their token types
3. **Mixed transactions**: Validate range proofs per-token instead of globally

These features would enable:
- More complex multi-party swaps
- Automated market makers without smart contracts
- Decentralized exchange functionality

## Limitations & TODOs

1. **Transaction builder integration**: The `add_signed_contingent_input()` function needs to be added to the main transaction builder to actually use SCIs in transactions.

2. **Ledger queries**: `is_sci_spendable()` needs integration with the ledger to check if key images have been spent.

3. **Commitment verification**: Full protobuf parsing and verification of required output commitments in `validate_signed_contingent_input()`.

4. **Multi-token support**: Currently only MOB (token_id = 0) is supported. Multi-asset support requires the changes described in MCIP-0031.

5. **Range proof aggregation**: When multiple token types are used, range proofs need to be generated per-token.

## Testing

To test the SCI implementation:

```bash
cargo test --lib sci
```

(Note: Comprehensive tests need to be added)

## References

- [MCIP-0031: Transactions with Contingent Inputs](https://github.com/mobilecoinfoundation/mcips/blob/main/text/0031-transactions-with-contingent-inputs.md)
- [MobileCoin Transaction Core](https://github.com/mobilecoinfoundation/mobilecoin/tree/main/transaction/core)
- [Ring MLSAG Signatures](https://github.com/mobilecoinfoundation/mobilecoin/tree/main/crypto/ring-signature)

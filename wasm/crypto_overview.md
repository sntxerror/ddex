# WASM Transaction Construction

`build_transaction` takes sender private keys, spendable owned outputs, a recipient address, and transaction parameters, then produces a signed, serialized MobileCoin transaction plus verification artifacts.

The goal of this note is to answer two questions:

1. What are the inputs and outputs of transaction construction?
2. What does each input and output represent?

## TL;DR

**Inputs**: sender keys, spendable outputs with rings, recipient address, amount, fee, change address, expiry block, optional fog key, optional payment request id.

**Outputs**: serialized transaction bytes, transaction prefix hash, per-input key images, and a recipient confirmation number.

**Meaning**: inputs describe who can spend, what funds are available, who gets paid, how much, and under what metadata; outputs describe the finished signed transaction and the proof artifacts needed for network validation and recipient verification.

## Main Entrypoint

- [build_transaction](src/transaction.rs#L1277): top-level WASM entrypoint that takes sender keys, spendable inputs, recipient metadata, and transaction parameters, then returns the fully built transaction artifacts.
- [select_inputs](src/transaction.rs#L1224): chooses which owned outputs to spend.
- [build_tx_out_inner](src/transaction.rs#L774): constructs each output, including one-time keys, masked amount fields, commitment, fog hint, and memo.
- [compute_mlsag_signing_digest](src/digestible.rs#L678): computes the digest that MLSAG actually signs.
- [compute_confirmation_number](src/transaction.rs#L748): derives a recipient-facing payment proof for the recipient output.

## Inputs

The core input types are defined in [src/transaction.rs](src/transaction.rs#L74).

### `account_key`

Represents the sender's private authority.

- `view_private_key`: used to derive shared secrets from transaction public keys and recover owned output data.
- `spend_private_key`: used to derive the one-time private keys required to spend owned outputs.

### `inputs`

Represents the owned outputs that may be spent to fund the transaction. Each item is an `OwnedTxOutInput`.

- `real_index`: index of the real spend inside its ring.
- `ring`: anonymity set used for ring signing.
- `subaddress_index`: which sender subaddress originally received the output.
- `value`: value of the owned output in picoMOB.
- `token_id`: asset type. `0` means MOB.

Each ring member contains:

- `target_key`: one-time destination key for that historical output.
- `public_key`: transaction public key associated with that output.
- `commitment`: Pedersen commitment to the output amount.
- `tx_out_bytes`: serialized TxOut used when encoding the final transaction.
- `proof_bytes`: membership proof used to show the output exists in the ledger.

### `recipient`

Represents the payment destination.

- `view_public_key`: recipient public view key.
- `spend_public_key`: recipient public spend key.
- `fog_report_url`: recipient fog metadata.

This data is used by [build_tx_out_inner](src/transaction.rs#L774) to derive the recipient's one-time output keys and fog hint.

### `amount`

Represents how much MOB to send to the recipient, in picoMOB.

### `fee`

Represents the network fee, in picoMOB.

### `change_recipient`

Represents where leftover value should be sent after `amount + fee`. In practice this is usually one of the sender's own addresses or subaddresses.

### `tombstone_block`

Represents the last block height where the transaction is valid. After this height, the transaction is expired.

### `fog_ingest_pubkey`

Optional fog ingest enclave public key. If present, [build_tx_out_inner](src/transaction.rs#L774) encrypts fog hints so fog services can discover outputs for the recipient.

### `payment_request_id`

Optional memo control field.

- If non-zero, the recipient output carries an authenticated sender memo.
- If non-zero, the change output carries a destination memo.
- If zero, both outputs use default zero memos for compatibility.

## Internal Construction Stages

The main transaction assembly flow is implemented in [src/transaction.rs](src/transaction.rs#L1277).

1. Deserialize account keys, owned inputs, and address data.
2. Use [select_inputs](src/transaction.rs#L1224) to choose enough inputs to cover `amount + fee`.
3. Compute `change_amount = total_input - amount - fee`.
4. Build memo payloads from recipient metadata and `payment_request_id`.
5. Build the recipient output with [build_tx_out_inner](src/transaction.rs#L774).
6. Build a change output with [build_tx_out_inner](src/transaction.rs#L774) if `change_amount > 0`.
7. Sort outputs and rings so the transaction matches MobileCoin validation rules.
8. Build pseudo-output commitments for each selected input.
9. Compute `tx_prefix_hash` from the transaction prefix.
10. Build the Bulletproof range proof over pseudo-outputs and outputs.
11. Compute the MLSAG signing digest with [compute_mlsag_signing_digest](src/digestible.rs#L678).
12. Sign each selected input to produce MLSAG signatures and key images.
13. Encode the full protobuf transaction into `tx_bytes`.
14. Compute the recipient-facing confirmation number with [compute_confirmation_number](src/transaction.rs#L748).

## Outputs

The return type is `TxBuildResult`, defined in [src/transaction.rs](src/transaction.rs#L155).

### `tx_bytes`

The full protobuf-encoded MobileCoin transaction, ready for submission. This is the complete wire-format transaction.

### `tx_prefix_hash`

The 32-byte hash of the transaction prefix. It identifies the signed transaction body and is one of the main consistency checks used in the test harness.

### `key_images`

One key image per signed input. A key image lets the network detect double-spends without revealing which ring member was actually spent.

### `confirmation_number`

A recipient-facing payment proof generated by [compute_confirmation_number](src/transaction.rs#L748). The recipient can verify it against the received TxOut using the shared secret derivable from that output.

## Related Files

- [src/transaction.rs](src/transaction.rs): transaction types, builder logic, output construction, signing, and result packaging.
- [src/digestible.rs](src/digestible.rs): digest construction used for MLSAG signing.
- [test/txgen.mjs](test/txgen.mjs): JS harness that calls the WASM function and compares outputs against fixture data.
- [test/tx_fixture.json](test/tx_fixture.json): example input fixture and expected comparison values.
- [test/README.md](test/README.md): quick commands for running the current test scripts.

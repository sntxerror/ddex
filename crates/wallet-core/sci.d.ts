/**
 * TypeScript type definitions for Signed Contingent Input (SCI) WASM bindings
 * 
 * These types will be automatically generated in pkg/wasm.d.ts after running:
 *   wasm-pack build --target web
 * 
 * This file serves as documentation and can be used for manual imports.
 */

/**
 * A ring member representing a potential TxOut that could be spent.
 * For privacy, transactions reference multiple ring members (decoys + real output).
 */
export interface RingMember {
  /** The one-time public key (target key) of the TxOut - 32 bytes */
  target_key: number[];
  
  /** The transaction public key from when this TxOut was created - 32 bytes */
  public_key: number[];
  
  /** The Pedersen commitment to the amount - 32 bytes */
  commitment: number[];
  
  /** Serialized TxOut protobuf bytes (optional) */
  tx_out_bytes: number[];
  
  /** Range proof bytes (optional) */
  proof_bytes: number[];
}

/**
 * Rules that must be satisfied for a contingent input to be valid.
 */
export interface InputRules {
  /** Required outputs that must appear in the transaction (as protobuf bytes) */
  required_outputs: number[][];
  
  /** Maximum block height at which this SCI expires (0 = no limit) */
  max_tombstone_block: number;
}

/**
 * An unmasked amount revealing the value, token_id, and blinding factor.
 * This is used to reconstruct commitments and verify SCI integrity.
 */
export interface UnmaskedAmount {
  /** The actual amount value in picoMOB or token units */
  value: number;
  
  /** Token ID (0 = MOB) */
  token_id: number;
  
  /** The blinding factor used in the Pedersen commitment - 32 bytes */
  blinding: number[];
}

/**
 * MLSAG ring signature used to prove ownership of one of the ring members.
 */
export interface RingMLSAG {
  /** Initial challenge value - 32 bytes */
  c_zero: number[];
  
  /** Response scalars for each ring member (2 per member) */
  responses: number[][];
  
  /** Key image uniquely identifying the spent output - 32 bytes */
  key_image: number[];
}

/**
 * A Signed Contingent Input - a transaction fragment that can be safely shared.
 * 
 * SCIs enable atomic swaps: "I'll spend my tokens IF you include these specific outputs."
 * Multiple SCIs can be combined into one transaction by any party.
 */
export interface SignedContingentInput {
  /** Block version to use (typically 3) */
  block_version: number;
  
  /** Ring of potential inputs for privacy */
  ring: RingMember[];
  
  /** Optional rules that must be satisfied */
  input_rules?: InputRules;
  
  /** MLSAG signature proving ownership */
  mlsag: RingMLSAG;
  
  /** Unmasked pseudo-output commitment */
  pseudo_output_unmasked: UnmaskedAmount;
  
  /** Unmasked required outputs for verification */
  required_outputs_unmasked: UnmaskedAmount[];
  
  /** Global indices of ring members in the ledger */
  tx_out_global_indices: number[];
}

/**
 * A built transaction output ready for inclusion in a transaction.
 */
export interface BuiltTxOut {
  /** Amount value in picoMOB or token units */
  value: number;
  
  /** Token ID (0 = MOB) */
  token_id: number;
  
  /** Target key (one-time public key) - 32 bytes compressed Ristretto */
  target_key: number[];
  
  /** Transaction public key - 32 bytes compressed Ristretto */
  public_key: number[];
  
  /** Pedersen commitment - 32 bytes compressed Ristretto */
  commitment: number[];
  
  /** Masked amount value (encrypted) */
  masked_value: number;
  
  /** Masked token ID bytes (encrypted) */
  masked_token_id: number[];
  
  /** Encrypted fog hint for Fog users */
  e_fog_hint: number[];
  
  /** Encrypted memo data */
  e_memo: number[];
  
  /** Blinding factor for the commitment - 32 bytes */
  blinding: number[];
}

/**
 * Account key containing view and spend private keys.
 */
export interface AccountKey {
  /** View private key - 32 bytes */
  view_private_key: number[];
  
  /** Spend private key - 32 bytes */
  spend_private_key: number[];
}

/**
 * Input data for creating an SCI.
 */
export interface OwnedSCIInput {
  /** Index of the real input in the ring (0-based) */
  real_index: number;
  
  /** Ring of potential inputs */
  ring: RingMember[];
  
  /** Subaddress index where this TxOut was received */
  subaddress_index: number;
  
  /** The actual value of the input in picoMOB or token units */
  value: number;
  
  /** Token ID (0 = MOB) */
  token_id: number;
}

/**
 * Result of building a transaction with SCIs.
 */
export interface TxBuildResult {
  /** Serialized transaction bytes ready for submission */
  tx_bytes: number[];
  
  /** Transaction prefix hash for tracking */
  tx_prefix_hash: number[];
  
  /** Key images of all inputs (for double-spend detection) */
  key_images: number[][];
}

/**
 * Create a Signed Contingent Input from an owned TxOut.
 * 
 * This creates a "transaction fragment" that says: "I'll spend this input IF the
 * transaction includes these required outputs." Perfect for atomic swaps.
 * 
 * @param account_key_js - Your account private keys (view + spend)
 * @param input_js - The TxOut you want to spend (with ring) as OwnedSCIInput
 * @param required_outputs_js - Array of BuiltTxOut that must appear in the transaction
 * @param max_tombstone_block - Optional expiration block (0 = no limit)
 * @param block_version - Block version to use (typically 3)
 * @returns A SignedContingentInput that can be serialized and shared
 * 
 * @example
 * ```typescript
 * // Alice wants to trade 100 MOB for Bob's required output
 * const sci = await create_signed_contingent_input(
 *   { view_private_key: aliceViewKey, spend_private_key: aliceSpendKey },
 *   { real_index: 0, ring: aliceRing, subaddress_index: 0n, value: 100_000_000, token_id: 0 },
 *   [bobsRequiredOutput],
 *   2000n, // Expires at block 2000
 *   3
 * );
 * ```
 */
export function create_signed_contingent_input(
  account_key_js: AccountKey,
  input_js: OwnedSCIInput,
  required_outputs_js: BuiltTxOut[],
  max_tombstone_block: bigint,
  block_version: number
): Promise<SignedContingentInput>;

/**
 * Validate a received SignedContingentInput.
 * 
 * Verifies:
 * 1. Unmasked amounts match their commitments
 * 2. MLSAG signature is valid
 * 3. Pseudo-output commitment is correct
 * 
 * Always validate SCIs before using them in transactions!
 * 
 * @param sci_js - The SignedContingentInput to validate
 * @throws Error if validation fails with details
 * 
 * @example
 * ```typescript
 * try {
 *   await validate_signed_contingent_input(receivedSCI);
 *   console.log("SCI is valid!");
 * } catch (error) {
 *   console.error("Invalid SCI:", error.message);
 * }
 * ```
 */
export function validate_signed_contingent_input(
  sci_js: SignedContingentInput
): Promise<void>;

/**
 * Check if a SignedContingentInput is still spendable.
 * 
 * Returns true if the key image has not appeared in the ledger yet.
 * In a real implementation, this would query the ledger.
 * 
 * @param sci_js - The SignedContingentInput to check
 * @returns true if spendable, false if already spent
 * 
 * @example
 * ```typescript
 * const isSpendable = await is_sci_spendable(sci);
 * if (!isSpendable) {
 *   console.log("This SCI has already been spent!");
 * }
 * ```
 */
export function is_sci_spendable(
  sci_js: SignedContingentInput
): Promise<boolean>;

/**
 * Build a transaction that includes Signed Contingent Inputs.
 * 
 * Combines multiple SCIs into a complete transaction ready for network submission.
 * This is how you complete an atomic swap after receiving SCIs from counterparties.
 * 
 * @param scis_js - Array of SignedContingentInput objects (at least one required)
 * @param account_key_js - Optional account key for signing additional inputs (null if none)
 * @param additional_inputs_js - Optional regular inputs to add (null if none)
 * @param fee - Transaction fee in picoMOB
 * @param tombstone_block - Maximum block height for transaction validity
 * @returns TxBuildResult with transaction bytes ready for submission
 * 
 * @example
 * ```typescript
 * // Combine Alice's and Bob's SCIs into one transaction
 * const result = await build_transaction_with_scis(
 *   [aliceSCI, bobSCI],
 *   null, // No additional signing needed
 *   null, // No additional inputs
 *   400n, // 400 picoMOB fee
 *   2000n // Valid until block 2000
 * );
 * // Submit result.tx_bytes to the network
 * ```
 */
export function build_transaction_with_scis(
  scis_js: SignedContingentInput[],
  account_key_js: AccountKey | null,
  additional_inputs_js: any[] | null,
  fee: bigint,
  tombstone_block: bigint
): Promise<TxBuildResult>;

/**
 * Serialize a SignedContingentInput to a hex string.
 * 
 * Perfect for sharing SCIs via messaging apps, QR codes, or any text-based channel.
 * The hex encoding makes binary data safe for copy-paste.
 * 
 * @param sci_js - The SignedContingentInput to serialize
 * @returns Hex-encoded string (typically ~1528 characters)
 * 
 * @example
 * ```typescript
 * const sci = await create_signed_contingent_input(...);
 * const hexSci = await serialize_sci_to_hex(sci);
 * // Send hexSci to your trading partner via Signal, Telegram, etc.
 * console.log("Share this:", hexSci);
 * ```
 */
export function serialize_sci_to_hex(
  sci_js: SignedContingentInput
): Promise<string>;

/**
 * Deserialize a SignedContingentInput from a hex string.
 * 
 * Reconstructs an SCI from a hex string received from a counterparty.
 * Always validate the SCI after deserializing!
 * 
 * @param hex - Hex-encoded string from serialize_sci_to_hex
 * @returns Reconstructed SignedContingentInput
 * 
 * @example
 * ```typescript
 * const sci = await deserialize_sci_from_hex(receivedHexString);
 * await validate_signed_contingent_input(sci); // Always validate!
 * // Now you can use this SCI in build_transaction_with_scis
 * ```
 */
export function deserialize_sci_from_hex(
  hex: string
): Promise<SignedContingentInput>;

/**
 * Serialize a SignedContingentInput to binary bytes.
 * 
 * Provides raw binary serialization for efficient storage or transmission
 * over binary protocols. Use serialize_sci_to_hex for text-based channels.
 * 
 * @param sci_js - The SignedContingentInput to serialize
 * @returns Binary bytes (typically ~764 bytes)
 * 
 * @example
 * ```typescript
 * const bytes = await serialize_sci_to_bytes(sci);
 * // Save to file or send over binary protocol
 * ```
 */
export function serialize_sci_to_bytes(
  sci_js: SignedContingentInput
): Promise<Uint8Array>;

/**
 * Deserialize a SignedContingentInput from binary bytes.
 * 
 * Reconstructs an SCI from raw binary data.
 * Use deserialize_sci_from_hex for text-based channels.
 * 
 * @param bytes - Binary bytes from serialize_sci_to_bytes
 * @returns Reconstructed SignedContingentInput
 * 
 * @example
 * ```typescript
 * const bytes = await readFile('sci.bin');
 * const sci = await deserialize_sci_from_bytes(bytes);
 * await validate_signed_contingent_input(sci);
 * ```
 */
export function deserialize_sci_from_bytes(
  bytes: Uint8Array
): Promise<SignedContingentInput>;

/**
 * Extract the key image from a SignedContingentInput.
 * 
 * The key image uniquely identifies whether an input has been spent.
 * Use this to check if an SCI is still valid by querying your ledger.
 * 
 * @param sci_js - The SignedContingentInput to extract from
 * @returns The 32-byte key image as a hex string (64 hex characters)
 * 
 * @example
 * ```typescript
 * const sci = await deserialize_sci_from_hex(receivedHexString);
 * const keyImage = await get_sci_key_image(sci);
 * 
 * // Query your ledger to check if this key image is spent
 * const isSpent = await ledgerAPI.isKeyImageSpent(keyImage);
 * if (isSpent) {
 *   console.log("Warning: This SCI has already been spent!");
 * }
 * ```
 */
export function get_sci_key_image(
  sci_js: SignedContingentInput
): Promise<string>;

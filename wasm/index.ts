export interface WalletAccountKey {
  view_private_key: Uint8Array
  spend_private_key: Uint8Array
  fog_report_url: string
  fog_authority_spki: Uint8Array
}

interface WasmAccountKey {
  readonly view_private_key: Uint8Array
  readonly spend_private_key: Uint8Array
  readonly fog_report_url: string
  readonly fog_authority_spki: Uint8Array
}

type GeneratedInitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module
  | Promise<RequestInfo | URL | Response | BufferSource | WebAssembly.Module>

export interface ScanResult {
  owned: boolean
  subaddress_index: number | null
  value: bigint | null
  token_id: bigint | null
  key_image: number[] | null // 32 bytes
  global_index: bigint
  block_index: bigint
  memo: DecodedMemo | null
}

export interface DecodedMemo {
  memo_type: number
  sender_address_hash?: number[]
  payment_request_id?: string
  destination_address_hash?: number[]
  total_outlay?: string
}

export interface KexRngSearchKeys {
  search_keys: number[][]  // each 16 bytes
  next_index: string       // u64 as string
}

export interface TxOutData {
  target_key: number[]
  public_key: number[]
  masked_value: bigint
  masked_token_id: number[]
  commitment: number[]
  global_index: bigint
  block_index: bigint
  e_memo?: number[]
}

interface GeneratedWalletCoreModule {
  readonly default: (moduleOrPath?: GeneratedInitInput) => Promise<{ readonly memory: WebAssembly.Memory }>
  readonly generate_mnemonic: () => string
  readonly validate_mnemonic: (phrase: string) => boolean
  readonly mnemonic_to_account_key: (
    phrase: string,
    fogReportUrl: string,
    fogAuthoritySpki: Uint8Array,
  ) => WasmAccountKey
  readonly get_b58_address: (accountKey: WasmAccountKey) => string
  readonly scan_tx_out: (
    txOut: TxOutData,
    viewPrivateKey: Uint8Array,
    spendPrivateKey: Uint8Array,
    numSubaddresses: bigint,
  ) => ScanResult
  readonly derive_kex_rng_search_keys: (
    viewPrivateKey: Uint8Array,
    spendPrivateKey: Uint8Array,
    rngPubkey: Uint8Array,
    startIndex: bigint,
    count: number,
  ) => KexRngSearchKeys
  readonly compute_key_image: (
    viewPrivateKey: Uint8Array,
    spendPrivateKey: Uint8Array,
    subaddressIndex: bigint,
    txOutPublicKey: Uint8Array,
  ) => Uint8Array
  readonly decrypt_fog_ciphertext: (
    viewPrivateKey: Uint8Array,
    spendPrivateKey: Uint8Array,
    ciphertext: Uint8Array,
  ) => Uint8Array
  readonly decode_b58_address: (b58: string) => DecodedAddress
  readonly build_transaction: (
    accountKey: WasmAccountKey,
    inputs: OwnedTxOutInput[],
    recipient: Recipient,
    amount: bigint,
    fee: bigint,
    changeRecipient: Recipient,
    tombstoneBlock: bigint,
    fogIngestPubkey: Uint8Array | null,
    paymentRequestId: bigint,
  ) => TxBuildResult
  readonly derive_subaddress: (
    accountKey: WasmAccountKey,
    index: bigint,
  ) => DerivedSubaddress
}

type GeneratedModuleLoader = () => Promise<GeneratedWalletCoreModule>

const generatedModuleLoaders = import.meta.glob('./pkg/wallet_core.js')

let initPromise: Promise<void> | null = null
let modulePromise: Promise<GeneratedWalletCoreModule> | null = null
let generatedModule: GeneratedWalletCoreModule | null = null

function getGeneratedModuleLoader(): GeneratedModuleLoader {
  const loader = generatedModuleLoaders['./pkg/wallet_core.js']

  if (!loader) {
    throw new Error('Missing generated wallet-core package. Run `pnpm build:wasm` from the repo root first.')
  }

  return loader as GeneratedModuleLoader
}

async function loadGeneratedModule(): Promise<GeneratedWalletCoreModule> {
  if (!modulePromise) {
    modulePromise = getGeneratedModuleLoader()()
      .then((module) => {
        generatedModule = module
        return module
      })
      .catch((error: unknown) => {
        modulePromise = null
        generatedModule = null
        throw error
      })
  }

  return modulePromise
}

function normalizeBytes(value: unknown, fieldName: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value)
  }

  throw new Error(`wallet-core returned an unexpected ${fieldName} value`)
}

function normalizeAccountKey(value: unknown): WalletAccountKey {
  if (!value || typeof value !== 'object') {
    throw new Error('wallet-core returned an invalid account key payload')
  }

  const record = value as WasmAccountKey

  return {
    view_private_key: normalizeBytes(record.view_private_key, 'view_private_key'),
    spend_private_key: normalizeBytes(record.spend_private_key, 'spend_private_key'),
    fog_report_url: typeof record.fog_report_url === 'string' ? record.fog_report_url : '',
    fog_authority_spki: normalizeBytes(record.fog_authority_spki, 'fog_authority_spki'),
  }
}

export async function initWalletCore() {
  if (!initPromise) {
    initPromise = loadGeneratedModule()
      .then((module) => module.default(new URL('./pkg/wallet_core_bg.wasm', import.meta.url)))
      .then(() => undefined)
      .catch((error: unknown) => {
        initPromise = null
        throw error
      })
  }

  return initPromise
}

export async function generateMnemonic() {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.generate_mnemonic()
}

export function validateMnemonic(phrase: string) {
  return generatedModule?.validate_mnemonic(phrase) ?? false
}

export async function accountKeyFromMnemonic(
  phrase: string,
  fogReportUrl: string,
  fogAuthoritySpki: Uint8Array,
): Promise<WalletAccountKey> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return normalizeAccountKey(module.mnemonic_to_account_key(phrase, fogReportUrl, fogAuthoritySpki))
}

export async function getAddressForAccount(accountKey: WalletAccountKey): Promise<string> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.get_b58_address(accountKey)
}

export async function scanTxOut(
  txOut: TxOutData,
  viewPrivateKey: Uint8Array,
  spendPrivateKey: Uint8Array,
  numSubaddresses: bigint,
): Promise<ScanResult> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.scan_tx_out(txOut, viewPrivateKey, spendPrivateKey, numSubaddresses)
}

export async function deriveKexRngSearchKeys(
  viewPrivateKey: Uint8Array,
  spendPrivateKey: Uint8Array,
  rngPubkey: Uint8Array,
  startIndex: bigint,
  count: number,
): Promise<KexRngSearchKeys> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.derive_kex_rng_search_keys(viewPrivateKey, spendPrivateKey, rngPubkey, startIndex, count)
}

export async function computeKeyImage(
  viewPrivateKey: Uint8Array,
  spendPrivateKey: Uint8Array,
  subaddressIndex: bigint,
  txOutPublicKey: Uint8Array,
): Promise<Uint8Array> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.compute_key_image(viewPrivateKey, spendPrivateKey, subaddressIndex, txOutPublicKey)
}

export async function decryptFogCiphertext(
  viewPrivateKey: Uint8Array,
  spendPrivateKey: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.decrypt_fog_ciphertext(viewPrivateKey, spendPrivateKey, ciphertext)
}

// ── Types for transaction construction ──

export interface DecodedAddress {
  view_public_key: number[]
  spend_public_key: number[]
  fog_report_url: string
}

export interface Recipient {
  view_public_key: number[]
  spend_public_key: number[]
  fog_report_url: string
}

export interface RingMember {
  target_key: number[]
  public_key: number[]
  commitment: number[]
  tx_out_bytes: number[]
  proof_bytes: number[]
}

export interface OwnedTxOutInput {
  real_index: number
  ring: RingMember[]
  subaddress_index: number
  value: bigint
  token_id: bigint
}

export interface TxBuildResult {
  tx_bytes: number[]
  tx_prefix_hash: number[]
  key_images: number[][]
  confirmation_number: number[]
}

export interface DerivedSubaddress {
  view_public_key: number[]
  spend_public_key: number[]
  fog_report_url: string
  fog_authority_sig: number[]
  subaddress_index: number
}

// ── Transaction-related wrappers ──

export async function decodeB58Address(b58: string): Promise<DecodedAddress> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.decode_b58_address(b58)
}

export async function buildTransaction(
  accountKey: WalletAccountKey,
  inputs: OwnedTxOutInput[],
  recipient: Recipient,
  amount: bigint,
  fee: bigint,
  changeRecipient: Recipient,
  tombstoneBlock: bigint,
  fogIngestPubkey: Uint8Array | null,
  paymentRequestId: bigint,
): Promise<TxBuildResult> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.build_transaction(
    accountKey,
    inputs,
    recipient,
    amount,
    fee,
    changeRecipient,
    tombstoneBlock,
    fogIngestPubkey,
    paymentRequestId,
  )
}

export async function deriveSubaddress(
  accountKey: WalletAccountKey,
  index: bigint,
): Promise<DerivedSubaddress> {
  const module = await loadGeneratedModule()
  await initWalletCore()
  return module.derive_subaddress(accountKey, index)
}
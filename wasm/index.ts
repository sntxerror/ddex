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
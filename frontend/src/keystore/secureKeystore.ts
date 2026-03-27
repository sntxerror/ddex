const DB_NAME = 'ddex-secure-keystore'
const DB_VERSION = 1
const STORE_NAME = 'wallets'
const PRIMARY_KEY = 'primary-wallet'
const KDF_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface StoredWalletKeystoreMetadata {
  readonly createdAt: string
  readonly id: string
  readonly iterations: number
  readonly kdf: 'PBKDF2-SHA-256'
  readonly updatedAt: string
  readonly version: number
}

interface StoredWalletKeystoreRecord extends StoredWalletKeystoreMetadata {
  readonly ciphertext: string
  readonly iv: string
  readonly salt: string
}

function ensureSecureKeystoreSupport() {
  if (!isSecureKeystoreSupported()) {
    throw new Error('This browser does not support IndexedDB + WebCrypto secure storage.')
  }
}

function getDatabase(): Promise<IDBDatabase> {
  ensureSecureKeystoreSupport()

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'))
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab or worker.'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const request = operation(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
    transaction.oncomplete = () => database.close()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  bytes.forEach((value) => {
    binary += String.fromCharCode(value)
  })

  return btoa(binary)
}

function decodeBase64(value: string, fieldName: string): Uint8Array {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new Error(`Stored keystore contains an invalid ${fieldName} payload.`)
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function deriveEncryptionKey(passphrase: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

async function getStoredRecord(): Promise<StoredWalletKeystoreRecord | null> {
  const record = await withStore<StoredWalletKeystoreRecord | undefined>('readonly', (store) =>
    store.get(PRIMARY_KEY),
  )

  return record ?? null
}

async function requestPersistentStorage() {
  if (!('storage' in navigator) || typeof navigator.storage.persist !== 'function') {
    return
  }

  try {
    await navigator.storage.persist()
  } catch {
    // Best-effort only.
  }
}

export function isSecureKeystoreSupported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
}

export async function getStoredWalletKeystoreMetadata(): Promise<StoredWalletKeystoreMetadata | null> {
  const record = await getStoredRecord()

  if (!record) {
    return null
  }

  return {
    createdAt: record.createdAt,
    id: record.id,
    iterations: record.iterations,
    kdf: record.kdf,
    updatedAt: record.updatedAt,
    version: record.version,
  }
}

export async function saveWalletKeystore(mnemonic: string, passphrase: string): Promise<StoredWalletKeystoreMetadata> {
  ensureSecureKeystoreSupport()

  const normalizedMnemonic = mnemonic.trim().replace(/\s+/g, ' ')
  const normalizedPassphrase = passphrase.trim()

  if (!normalizedMnemonic) {
    throw new Error('No mnemonic is loaded to save.')
  }

  if (!/^\d{4,8}$/.test(normalizedPassphrase)) {
    throw new Error('Use a 4 to 8 digit PIN code for the device vault lock.')
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveEncryptionKey(normalizedPassphrase, salt, ['encrypt'])
  const plaintext = new TextEncoder().encode(normalizedMnemonic)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const existing = await getStoredRecord()
  const createdAt = existing?.createdAt ?? new Date().toISOString()
  const metadata: StoredWalletKeystoreMetadata = {
    createdAt,
    id: PRIMARY_KEY,
    iterations: KDF_ITERATIONS,
    kdf: 'PBKDF2-SHA-256',
    updatedAt: new Date().toISOString(),
    version: 1,
  }
  const record: StoredWalletKeystoreRecord = {
    ...metadata,
    ciphertext: encodeBase64(new Uint8Array(encrypted)),
    iv: encodeBase64(iv),
    salt: encodeBase64(salt),
  }

  await withStore('readwrite', (store) => store.put(record))
  await requestPersistentStorage()

  return metadata
}

export async function unlockStoredWalletMnemonic(passphrase: string): Promise<string> {
  ensureSecureKeystoreSupport()

  const normalizedPassphrase = passphrase.trim()
  if (!normalizedPassphrase) {
    throw new Error('Enter your PIN code to unlock the stored wallet.')
  }

  const record = await getStoredRecord()
  if (!record) {
    throw new Error('No encrypted wallet is stored in this browser yet.')
  }

  const salt = decodeBase64(record.salt, 'salt')
  const iv = decodeBase64(record.iv, 'iv')
  const ciphertext = decodeBase64(record.ciphertext, 'ciphertext')
  const key = await deriveEncryptionKey(normalizedPassphrase, salt, ['decrypt'])

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new Error('Vault unlock failed. The PIN code was incorrect or the stored data was modified.')
  }
}

export async function deleteStoredWalletKeystore(): Promise<void> {
  ensureSecureKeystoreSupport()
  await withStore('readwrite', (store) => store.delete(PRIMARY_KEY))
}

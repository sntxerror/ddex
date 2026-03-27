/**
 * Noise Protocol NX pattern for MobileCoin attested connections.
 *
 * Protocol: Noise_NX_25519_AESGCM_SHA512
 *
 * NX pattern:
 *   -> e               (initiator sends ephemeral pubkey)
 *   <- e, ee, s, es    (responder sends ephemeral + static, derives shared secrets)
 *
 * After handshake, both sides hold symmetric AES-256-GCM ciphers for
 * encrypting/decrypting attest.Message payloads.
 *
 * Adapted from kyoto-wallet-main reference implementation.
 */

import { x25519 } from '@noble/curves/ed25519.js'

const PROTOCOL_NAME = 'Noise_NX_25519_AESGCM_SHA512'
const DHLEN = 32
const HASHLEN = 64
const MAX_NONCE = 2n ** 64n - 1n

const encoder = new TextEncoder()

function toAB(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', toAB(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, toAB(data)))
}

async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', toAB(data)))
}

async function hkdfSha512(chainingKey: Uint8Array, ikm: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const tempKey = await hmacSha512(chainingKey, ikm)
  const output1 = await hmacSha512(tempKey, new Uint8Array([0x01]))
  const output2 = await hmacSha512(tempKey, concat(output1, new Uint8Array([0x02])))
  return [output1, output2]
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

interface KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

function generateKeyPair(): KeyPair {
  const privateKey = new Uint8Array(32)
  crypto.getRandomValues(privateKey)
  const publicKey = x25519.getPublicKey(privateKey)
  return { privateKey, publicKey }
}

function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey)
}

// ── CipherState ──

class CipherState {
  private key: CryptoKey | null = null
  private nonce = 0n

  async initializeKey(keyBytes: Uint8Array): Promise<void> {
    this.key = await crypto.subtle.importKey(
      'raw', toAB(keyBytes), 'AES-GCM', false, ['encrypt', 'decrypt'],
    )
    this.nonce = 0n
  }

  hasKey(): boolean {
    return this.key !== null
  }

  async encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.key) throw new Error('CipherState: no key set')
    if (this.nonce > MAX_NONCE) throw new Error('CipherState: nonce overflow')

    const nonceBuf = new Uint8Array(12)
    const dv = new DataView(nonceBuf.buffer)
    dv.setBigUint64(4, this.nonce, false)

    const result = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonceBuf, additionalData: toAB(ad), tagLength: 128 },
      this.key, toAB(plaintext),
    )
    this.nonce++

    return new Uint8Array(result)
  }

  async decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.key) throw new Error('CipherState: no key set')
    if (ciphertext.length < 16) throw new Error('CipherState: ciphertext too short')

    const nonceBuf = new Uint8Array(12)
    const dv = new DataView(nonceBuf.buffer)
    dv.setBigUint64(4, this.nonce, false)

    const result = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonceBuf, additionalData: toAB(ad), tagLength: 128 },
      this.key, toAB(ciphertext),
    )
    this.nonce++

    return new Uint8Array(result)
  }
}

// ── SymmetricState ──

class SymmetricState {
  private chainingKey: Uint8Array
  private h: Uint8Array
  private cipher = new CipherState()

  private constructor(h: Uint8Array, ck: Uint8Array) {
    this.h = h
    this.chainingKey = ck
  }

  static create(): SymmetricState {
    const protocolBytes = encoder.encode(PROTOCOL_NAME)
    const h = new Uint8Array(HASHLEN)
    h.set(protocolBytes)
    return new SymmetricState(h, new Uint8Array(h))
  }

  async mixHash(data: Uint8Array): Promise<void> {
    this.h = await sha512(concat(this.h, data))
  }

  async mixKey(inputKeyMaterial: Uint8Array): Promise<void> {
    const [ck, tempK] = await hkdfSha512(this.chainingKey, inputKeyMaterial)
    this.chainingKey = ck
    await this.cipher.initializeKey(tempK.slice(0, 32))
  }

  async encryptAndHash(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.cipher.hasKey()) {
      await this.mixHash(plaintext)
      return plaintext
    }
    const ciphertext = await this.cipher.encryptWithAd(this.h, plaintext)
    await this.mixHash(ciphertext)
    return ciphertext
  }

  async decryptAndHash(ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.cipher.hasKey()) {
      await this.mixHash(ciphertext)
      return ciphertext
    }
    const plaintext = await this.cipher.decryptWithAd(this.h, ciphertext)
    await this.mixHash(ciphertext)
    return plaintext
  }

  async split(): Promise<[CipherState, CipherState]> {
    const [tempK1, tempK2] = await hkdfSha512(this.chainingKey, new Uint8Array(0))
    const c1 = new CipherState()
    await c1.initializeKey(tempK1.slice(0, 32))
    const c2 = new CipherState()
    await c2.initializeKey(tempK2.slice(0, 32))
    return [c1, c2]
  }

  getHandshakeHash(): Uint8Array {
    return new Uint8Array(this.h)
  }
}

// ── NoiseNXInitiator ──

export interface HandshakeResult {
  encryptCipher: CipherState
  decryptCipher: CipherState
  binding: Uint8Array
  remoteStaticKey: Uint8Array
}

export class NoiseNXInitiator {
  private ss: SymmetricState
  private e: KeyPair
  private initialized: Promise<void>

  constructor(responderId: string) {
    this.ss = SymmetricState.create()
    this.e = generateKeyPair()
    this.initialized = this.ss.mixHash(encoder.encode(responderId))
  }

  async writeMessage1(payload: Uint8Array = new Uint8Array(0)): Promise<Uint8Array> {
    await this.initialized
    await this.ss.mixHash(this.e.publicKey)
    const encryptedPayload = await this.ss.encryptAndHash(payload)
    return concat(this.e.publicKey, encryptedPayload)
  }

  async readMessage2(message: Uint8Array): Promise<HandshakeResult> {
    let offset = 0

    const re = message.slice(offset, offset + DHLEN)
    await this.ss.mixHash(re)
    offset += DHLEN

    await this.ss.mixKey(dh(this.e.privateKey, re))

    const encryptedRS = message.slice(offset, offset + DHLEN + 16)
    const rs = await this.ss.decryptAndHash(encryptedRS)
    offset += DHLEN + 16

    await this.ss.mixKey(dh(this.e.privateKey, rs))

    const encryptedPayload = message.slice(offset)
    if (encryptedPayload.length > 0) {
      await this.ss.decryptAndHash(encryptedPayload)
    }

    const binding = this.ss.getHandshakeHash()
    const [c1, c2] = await this.ss.split()

    return {
      encryptCipher: c1,
      decryptCipher: c2,
      binding,
      remoteStaticKey: new Uint8Array(rs),
    }
  }
}

// ── AttestedCipher ──

export class AttestedCipher {
  private sendCipher: CipherState
  private recvCipher: CipherState
  private _binding: Uint8Array

  constructor(result: HandshakeResult) {
    this.sendCipher = result.encryptCipher
    this.recvCipher = result.decryptCipher
    this._binding = result.binding
  }

  async encrypt(aad: Uint8Array, plaintext: Uint8Array): Promise<{
    aad: Uint8Array
    channelId: Uint8Array
    data: Uint8Array
  }> {
    const ciphertext = await this.sendCipher.encryptWithAd(aad, plaintext)
    return { aad, channelId: this._binding, data: ciphertext }
  }

  async decrypt(aad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    return this.recvCipher.decryptWithAd(aad, ciphertext)
  }

  get binding(): Uint8Array {
    return this._binding
  }
}

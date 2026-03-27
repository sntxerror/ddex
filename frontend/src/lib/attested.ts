/**
 * Attested connection manager for MobileCoin fog enclaves.
 *
 * Handles Noise NX handshake, encrypted request/response, session cookies
 * for load-balancer affinity, and automatic re-attestation on expiry.
 *
 * Requests go through the Vite dev proxy → Envoy gRPC-Web proxy → MC servers.
 * Path format: /test/fog/fog_view.FogViewAPI/Auth (Envoy strips the /test/fog prefix).
 */

import { NoiseNXInitiator, AttestedCipher } from './noise'
import { grpcFetch, GrpcError, GRPC_STATUS } from './grpc'
import { encodeAuthMessage, decodeAuthMessage, encodeAttestMessage, decodeAttestMessage } from './mc-proto'

export class AttestedConnection {
  private responderId: string
  private authPath: string
  cipher: AttestedCipher | null = null
  cookies: string = ''
  private attestPromise: Promise<void> | null = null
  private callQueue: Promise<unknown> = Promise.resolve()

  constructor(responderId: string, authPath: string) {
    this.responderId = responderId
    this.authPath = authPath
  }

  get isAttested(): boolean {
    return this.cipher !== null
  }

  private getCipher(): AttestedCipher | null {
    return this.cipher
  }

  async attest(): Promise<void> {
    this.cipher = null
    this.cookies = ''

    const initiator = new NoiseNXInitiator(this.responderId)

    // -> e (client sends ephemeral key)
    const msg1 = await initiator.writeMessage1()
    const authPayload = encodeAuthMessage(msg1)

    // <- e, ee, s, es (server responds with handshake + attestation)
    const { data, cookies } = await grpcFetch(
      this.authPath, authPayload,
      { timeoutMs: 60_000 },
    )

    if (cookies.length > 0) {
      this.cookies = cookies.join('; ')
    }

    const responseData = decodeAuthMessage(data)
    const result = await initiator.readMessage2(responseData)
    this.cipher = new AttestedCipher(result)
  }

  async ensureAttested(): Promise<void> {
    if (this.isAttested) return
    if (this.attestPromise) return this.attestPromise
    this.attestPromise = this.attest().finally(() => { this.attestPromise = null })
    return this.attestPromise
  }

  /**
   * Make an encrypted request to the attested enclave.
   * Serialized via callQueue to prevent concurrent cipher access.
   */
  async encryptedCall(
    grpcPath: string,
    requestBytes: Uint8Array,
    aad: Uint8Array = new Uint8Array(0),
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Uint8Array> {
    const result = this.callQueue.then(() =>
      this._encryptedCallInner(grpcPath, requestBytes, aad, opts),
    )
    this.callQueue = result.catch(() => { /* swallow for queue chaining */ })
    return result
  }

  private async _encryptedCallInner(
    grpcPath: string,
    requestBytes: Uint8Array,
    aad: Uint8Array,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Uint8Array> {
    await this.ensureAttested()
    if (!this.cipher) throw new Error('Attestation failed')

    const encrypted = await this.cipher.encrypt(aad, requestBytes)
    const payload = encodeAttestMessage(encrypted.aad, encrypted.channelId, encrypted.data)

    try {
      const { data, cookies } = await grpcFetch(
        grpcPath, payload,
        { cookies: this.cookies, timeoutMs: opts?.timeoutMs, signal: opts?.signal },
      )

      if (cookies.length > 0) {
        this.cookies = cookies.join('; ')
      }

      const response = decodeAttestMessage(data)
      return this.cipher.decrypt(response.aad, response.data)
    } catch (err) {
      if (err instanceof GrpcError &&
        (err.code === GRPC_STATUS.PERMISSION_DENIED || err.code === GRPC_STATUS.UNAUTHENTICATED)) {
        // Session expired — re-attest and retry once
        console.warn(`[attested] session expired (code ${err.code}), re-attesting...`)
        this.cipher = null
        this.cookies = ''
        await this.attest()

        // attest() sets this.cipher — getCipher() breaks TS narrowing
        const reattested = this.getCipher()
        if (!reattested) throw new Error('Re-attestation failed')

        const retryEncrypted = await reattested.encrypt(aad, requestBytes)
        const retryPayload = encodeAttestMessage(retryEncrypted.aad, retryEncrypted.channelId, retryEncrypted.data)
        const { data, cookies } = await grpcFetch(
          grpcPath, retryPayload,
          { cookies: this.cookies, timeoutMs: opts?.timeoutMs, signal: opts?.signal },
        )

        if (cookies.length > 0) {
          this.cookies = cookies.join('; ')
        }

        const response = decodeAttestMessage(data)
        return reattested.decrypt(response.aad, response.data)
      }
      throw err
    }
  }

  reset(): void {
    this.cipher = null
    this.cookies = ''
    this.attestPromise = null
  }
}

// ── Singleton connection pool ──

const connections = new Map<string, AttestedConnection>()

export function getConnection(
  name: string,
  responderId: string,
  authPath: string,
): AttestedConnection {
  let conn = connections.get(name)
  if (!conn) {
    conn = new AttestedConnection(responderId, authPath)
    connections.set(name, conn)
  }
  return conn
}

export function dropConnection(name: string): void {
  const conn = connections.get(name)
  if (conn) {
    conn.reset()
    connections.delete(name)
  }
}

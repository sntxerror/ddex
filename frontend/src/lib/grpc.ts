/**
 * gRPC-Web transport for browser fetch().
 *
 * Wire format (same for request and response data frames):
 *   byte 0:    flag (0x00 = data, 0x80 = trailer)
 *   bytes 1-4: big-endian uint32 payload length
 *   bytes 5+:  payload (protobuf for data, ASCII key-value for trailers)
 *
 * Requests go through the local Envoy proxy (Vite dev proxy → localhost:8080).
 */

export function grpcEncode(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + payload.length)
  frame[0] = 0
  const dv = new DataView(frame.buffer)
  dv.setUint32(1, payload.length, false)
  frame.set(payload, 5)
  return frame
}

function parseGrpcWebResponse(body: Uint8Array): {
  data: Uint8Array
  trailerStatus: number | null
  trailerMessage: string
} {
  let dataFrame: Uint8Array | null = null
  let trailerStatus: number | null = null
  let trailerMessage = ''
  let offset = 0

  while (offset + 5 <= body.length) {
    const flag = body[offset]
    const dv = new DataView(body.buffer, body.byteOffset + offset + 1, 4)
    const length = dv.getUint32(0, false)
    offset += 5

    if (offset + length > body.length) break

    if (flag & 0x80) {
      const text = new TextDecoder().decode(body.slice(offset, offset + length))
      const statusMatch = text.match(/grpc-status:\s*(\d+)/)
      const messageMatch = text.match(/grpc-message:\s*(.*?)(?:\r\n|$)/)
      trailerStatus = statusMatch ? parseInt(statusMatch[1], 10) : 0
      trailerMessage = messageMatch ? messageMatch[1] : ''
    } else {
      dataFrame = body.slice(offset, offset + length)
    }

    offset += length
  }

  return { data: dataFrame ?? new Uint8Array(0), trailerStatus, trailerMessage }
}

export const GRPC_STATUS = {
  OK: 0,
  PERMISSION_DENIED: 7,
  UNAUTHENTICATED: 16,
  DEADLINE_EXCEEDED: 4,
  UNAVAILABLE: 14,
} as const

export class GrpcError extends Error {
  readonly code: number
  readonly grpcMessage: string

  constructor(code: number, grpcMessage: string) {
    super(`gRPC error ${code}: ${grpcMessage}`)
    this.name = 'GrpcError'
    this.code = code
    this.grpcMessage = grpcMessage
  }
}

/**
 * Make a unary gRPC-Web call via fetch().
 *
 * `path` is the full gRPC path, e.g. `/test/fog/fog_view.FogViewAPI/Auth`.
 * The Vite dev server proxies `/test/*` and `/prod/*` to Envoy at localhost:8080.
 */
export async function grpcFetch(
  path: string,
  payload: Uint8Array,
  opts?: {
    cookies?: string
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<{ data: Uint8Array; cookies: string[] }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/grpc-web+proto',
    'X-Grpc-Web': '1',
  }
  if (opts?.cookies) {
    headers['Cookie'] = opts.cookies
  }

  const controller = new AbortController()
  const timeout = opts?.timeoutMs ?? 30_000
  const timer = setTimeout(() => controller.abort(), timeout)

  // If caller provides an external signal, forward its abort
  const externalSignal = opts?.signal
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    const onExternalAbort = () => controller.abort(externalSignal.reason)
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    // Clean up listener when our controller settles
    controller.signal.addEventListener('abort', () => {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }, { once: true })
  }

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers,
      body: grpcEncode(payload) as unknown as BodyInit,
      signal: controller.signal,
    })

    // Check HTTP-level errors (Envoy 503, upstream reset, etc.)
    if (!response.ok && !response.headers.get('grpc-status')) {
      throw new GrpcError(
        GRPC_STATUS.UNAVAILABLE,
        `HTTP ${response.status} ${response.statusText}`,
      )
    }

    const cookies: string[] = []
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) {
      for (const part of setCookie.split(',')) {
        const nameValue = part.split(';')[0].trim()
        if (nameValue && nameValue.includes('=')) {
          cookies.push(nameValue)
        }
      }
    }

    const body = new Uint8Array(await response.arrayBuffer())
    const { data, trailerStatus, trailerMessage } = parseGrpcWebResponse(body)

    const grpcStatusHeader = response.headers.get('grpc-status')
    const httpStatus = grpcStatusHeader !== null
      ? parseInt(grpcStatusHeader, 10)
      : null
    const httpMsg = response.headers.get('grpc-message') ?? ''

    const grpcStatus = httpStatus ?? trailerStatus ?? 0
    const grpcMsg = httpStatus !== null ? httpMsg : trailerMessage

    if (grpcStatus !== GRPC_STATUS.OK) {
      throw new GrpcError(grpcStatus, decodeURIComponent(grpcMsg))
    }

    return { data, cookies }
  } finally {
    clearTimeout(timer)
  }
}

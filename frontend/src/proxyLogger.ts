/** Global fetch interceptor for /fog and /consensus proxy routes.
 *  Emits 'proxy-log' CustomEvent on window (same tab) and
 *  posts to BroadcastChannel 'proxy-logs' (cross-tab). */

export interface ProxyLogEntry {
  id: number
  time: string
  method: string
  url: string
  status: number | null
  duration: number | null
  error: string | null
}

const PROXY_ROUTES = ['/fog', '/consensus']
const CHANNEL_NAME = 'proxy-logs'
let idCounter = 0

function emit(entry: ProxyLogEntry) {
  window.dispatchEvent(new CustomEvent('proxy-log', { detail: entry }))
  try { new BroadcastChannel(CHANNEL_NAME).postMessage(entry) } catch { /* unsupported */ }
}

export function installProxyInterceptor() {
  const originalFetch = window.fetch.bind(window)

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === 'string' ? input
        : input instanceof URL ? input.href
          : (input as Request).url
    const isProxy = PROXY_ROUTES.some(r => url.startsWith(r))

    if (!isProxy) return originalFetch(input, init)

    const id = ++idCounter
    const method = init?.method?.toUpperCase() || 'GET'
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    const start = performance.now()

    emit({ id, time, method, url, status: null, duration: null, error: null })

    try {
      const res = await originalFetch(input, init)
      const duration = Math.round(performance.now() - start)
      emit({ id, time, method, url, status: res.status, duration, error: null })
      return res
    } catch (err) {
      const duration = Math.round(performance.now() - start)
      const error = err instanceof Error ? err.message : String(err)
      emit({ id, time, method, url, status: 0, duration, error })
      throw err
    }
  }
}

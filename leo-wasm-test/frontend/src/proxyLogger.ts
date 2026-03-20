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

export const PROXY_ROUTES = ['/fog', '/consensus']
const CHANNEL_NAME = 'proxy-logs'
let idCounter = 0

/** Auto-detect the Envoy proxy base URL.
 *  - In Codespaces: swap -5173. for -8080. in the hostname
 *  - Locally: empty string (uses Vite dev proxy) */
export function getProxyBase(): string {
  const host = window.location.hostname
  // Codespace URL pattern: xxxx-5173.app.github.dev
  if (host.includes('.app.github.dev')) {
    const envoyHost = host.replace(/-\d+\.app\.github\.dev$/, '-8080.app.github.dev')
    return `https://${envoyHost}`
  }
  return '' // local dev — Vite proxy handles it
}

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
    const rawUrl =
      typeof input === 'string' ? input
        : input instanceof URL ? input.href
          : (input as Request).url
    const isProxy = PROXY_ROUTES.some(r => rawUrl.startsWith(r))

    if (!isProxy) return originalFetch(input, init)

    // Prepend the Envoy base URL (e.g. https://xxxx-8080.app.github.dev)
    const base = getProxyBase()
    const fullUrl = base ? base + rawUrl : rawUrl

    const id = ++idCounter
    const method = init?.method?.toUpperCase() || 'GET'
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    const start = performance.now()

    emit({ id, time, method, url: rawUrl, status: null, duration: null, error: null })

    try {
      const res = await originalFetch(fullUrl, init)
      const duration = Math.round(performance.now() - start)
      emit({ id, time, method, url: rawUrl, status: res.status, duration, error: null })
      return res
    } catch (err) {
      const duration = Math.round(performance.now() - start)
      const error = err instanceof Error ? err.message : String(err)
      emit({ id, time, method, url: rawUrl, status: 0, duration, error })
      throw err
    }
  }
}

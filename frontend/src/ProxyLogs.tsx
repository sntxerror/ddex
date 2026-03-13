import { useEffect, useRef, useState } from 'react'

interface LogEntry {
  id: number
  time: string
  method: string
  url: string
  status: number | null
  duration: number | null
  error: string | null
}

const PROXY_ROUTES = ['/fog', '/consensus']

export default function ProxyLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)

  useEffect(() => {
    const originalFetch = window.fetch

    window.fetch = async function patchedFetch(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const isProxy = PROXY_ROUTES.some(r => url.startsWith(r))

      if (!isProxy) return originalFetch(input, init)

      const id = ++idRef.current
      const method = init?.method?.toUpperCase() || 'GET'
      const time = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
      const start = performance.now()

      setLogs(prev => [...prev.slice(-199), { id, time, method, url, status: null, duration: null, error: null }])

      try {
        const res = await originalFetch(input, init)
        const duration = Math.round(performance.now() - start)
        setLogs(prev => prev.map(e => e.id === id ? { ...e, status: res.status, duration } : e))
        return res
      } catch (err) {
        const duration = Math.round(performance.now() - start)
        const error = err instanceof Error ? err.message : String(err)
        setLogs(prev => prev.map(e => e.id === id ? { ...e, status: 0, duration, error } : e))
        throw err
      }
    }

    return () => { window.fetch = originalFetch }
  }, [])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  const statusColor = (s: number | null) => {
    if (s === null) return '#555'
    if (s >= 200 && s < 300) return '#4ade80'
    if (s >= 400) return '#f85149'
    return '#facc15'
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0a0a',
      fontFamily: "'Courier New', monospace", color: '#4ade80',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #1a3a1a',
        display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0,
      }}>
        <a href="/" style={{ color: '#4ade80', textDecoration: 'none', opacity: 0.6 }}>
          &larr; back
        </a>
        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
          proxy-logs
        </span>
        <span style={{ opacity: 0.3, fontSize: '0.75rem' }}>
          {PROXY_ROUTES.join(' · ')}
        </span>
        <span style={{ flex: 1 }} />
        {PROXY_ROUTES.map(route => (
          <button
            key={route}
            onClick={() => { fetch(route + '/').catch(() => {}) }}
            style={{
              background: 'none', border: '1px solid #1a3a1a', color: '#a78bfa',
              padding: '4px 10px', borderRadius: '4px', cursor: 'pointer',
              fontSize: '0.72rem', opacity: 0.6,
            }}
          >
            ping {route}
          </button>
        ))}
        <label style={{ fontSize: '0.72rem', opacity: 0.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
            style={{ accentColor: '#4ade80' }}
          />
          auto-scroll
        </label>
        <button
          onClick={() => setLogs([])}
          style={{
            background: 'none', border: '1px solid #1a3a1a', color: '#4ade80',
            padding: '4px 10px', borderRadius: '4px', cursor: 'pointer',
            fontSize: '0.72rem', opacity: 0.6,
          }}
        >
          clear
        </button>
      </div>

      {/* Log area */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
        {logs.length === 0 && (
          <div style={{ opacity: 0.3, padding: '2rem 0', textAlign: 'center', fontSize: '0.8rem' }}>
            waiting for proxy requests...<br />
            <span style={{ fontSize: '0.7rem' }}>
              tap <span style={{ color: '#a78bfa' }}>ping</span> above to test, or fetch {PROXY_ROUTES.join(' / ')} from console
            </span>
          </div>
        )}
        {logs.map(entry => (
          <div
            key={entry.id}
            style={{
              padding: '3px 0',
              opacity: entry.status === null ? 0.4 : 1,
              transition: 'opacity 0.3s',
              fontSize: '0.78rem',
              lineHeight: 1.6,
            }}
          >
            <span style={{ color: '#555' }}>{entry.time}</span>
            {' '}
            <span style={{ color: '#a78bfa', fontWeight: 700 }}>{entry.method}</span>
            {' '}
            <span>{entry.url}</span>
            {entry.status !== null && (
              <>
                {' '}
                <span style={{ color: statusColor(entry.status) }}>
                  {entry.status === 0 ? 'ERR' : entry.status}
                </span>
              </>
            )}
            {entry.duration !== null && (
              <span style={{ color: '#555' }}> {entry.duration}ms</span>
            )}
            {entry.error && (
              <span style={{ color: '#f85149' }}> {entry.error}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 16px', borderTop: '1px solid #1a3a1a',
        fontSize: '0.68rem', opacity: 0.3, flexShrink: 0,
      }}>
        {logs.length} entries · intercepting window.fetch → {PROXY_ROUTES.join(', ')}
      </div>
    </div>
  )
}

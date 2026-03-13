import { useEffect, useRef, useState, useCallback } from 'react'
import type { ProxyLogEntry } from './proxyLogger'

const PROXY_ROUTES = ['/fog', '/consensus']
const CHANNEL_NAME = 'proxy-logs'

export default function ProxyLogs() {
  const [logs, setLogs] = useState<ProxyLogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const handleEntry = useCallback((entry: ProxyLogEntry) => {
    setLogs(prev => {
      // Update existing entry (status filled in) or append new
      const idx = prev.findIndex(e => e.id === entry.id)
      if (idx !== -1) {
        const next = [...prev]
        next[idx] = entry
        return next
      }
      return [...prev.slice(-199), entry]
    })
  }, [])

  useEffect(() => {
    // Listen for same-tab events (from the global interceptor in main.tsx)
    const onLocal = (e: Event) => handleEntry((e as CustomEvent).detail)
    window.addEventListener('proxy-log', onLocal)

    // Listen for cross-tab events via BroadcastChannel
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = (e) => handleEntry(e.data)
    } catch { /* BroadcastChannel unsupported */ }

    return () => {
      window.removeEventListener('proxy-log', onLocal)
      channel?.close()
    }
  }, [handleEntry])

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
        {logs.length} entries · listening on all tabs → {PROXY_ROUTES.join(', ')}
      </div>
    </div>
  )
}

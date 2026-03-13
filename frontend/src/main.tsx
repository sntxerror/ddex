import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installProxyInterceptor } from './proxyLogger.ts'

// Intercept fetch globally so proxy calls on ANY page are logged
installProxyInterceptor()

const isProxyLogs = window.location.pathname === '/proxy-logs'

async function mount() {
  const { default: Page } = isProxyLogs
    ? await import('./ProxyLogs.tsx')
    : await import('./App.tsx')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  )
}

mount()

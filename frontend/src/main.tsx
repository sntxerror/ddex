import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ProxyLogs from './ProxyLogs.tsx'
import { installProxyInterceptor } from './proxyLogger.ts'

// Intercept fetch globally so proxy calls on ANY page are logged
installProxyInterceptor()

const Page = window.location.pathname === '/proxy-logs' ? ProxyLogs : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)

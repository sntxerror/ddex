import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ProxyLogs from './ProxyLogs.tsx'

const Page = window.location.pathname === '/proxy-logs' ? ProxyLogs : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)

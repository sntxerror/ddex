import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AppThemeProvider } from './components/AppThemeProvider'
import './index.css'

if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}

async function mount() {
  const { default: Page } = await import('./App.tsx')
  const rootElement = document.getElementById('root')

  if (!rootElement) {
    throw new Error('Unable to find the #root element required to mount the app.')
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppThemeProvider>
        <Page />
      </AppThemeProvider>
    </StrictMode>,
  )
}

mount()

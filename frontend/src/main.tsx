import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppThemeProvider } from './components/AppThemeProvider'
import './index.css'

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

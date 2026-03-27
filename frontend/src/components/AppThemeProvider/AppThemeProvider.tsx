import '@mantine/core/styles.css'
import { MantineProvider, createTheme, localStorageColorSchemeManager } from '@mantine/core'
import styles from './AppThemeProvider.module.css'
import type { AppThemeProviderProps } from './AppThemeProvider.types'

const fontFamily = "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'ddex-color-scheme',
})

const theme = createTheme({
  primaryColor: 'cyan',
  defaultRadius: 'lg',
  defaultGradient: {
    from: 'cyan',
    to: 'teal',
    deg: 135,
  },
  fontFamily,
  headings: {
    fontFamily,
  },
  colors: {
    dark: [
      '#cbd5e1',
      '#94a3b8',
      '#64748b',
      '#475569',
      '#334155',
      '#1e293b',
      '#172033',
      '#111827',
      '#0f172a',
      '#0a0e1a',
    ],
  },
  components: {
    Paper: {
      defaultProps: {
        radius: 'xl',
        withBorder: true,
      },
    },
    Button: {
      defaultProps: {
        radius: 'lg',
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: 'xl',
        variant: 'light',
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'xl',
        variant: 'filled',
      },
    },
    PasswordInput: {
      defaultProps: {
        radius: 'xl',
        variant: 'filled',
      },
    },
    Textarea: {
      defaultProps: {
        radius: 'xl',
        variant: 'filled',
      },
    },
  },
})

export function AppThemeProvider({ children }: AppThemeProviderProps) {
  return (
    <MantineProvider
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="dark"
      theme={theme}
    >
      <div className={styles.viewport}>{children}</div>
    </MantineProvider>
  )
}

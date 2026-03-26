import '@mantine/core/styles.css'
import { MantineProvider, createTheme, localStorageColorSchemeManager } from '@mantine/core'
import styles from './AppThemeProvider.module.css'
import type { AppThemeProviderProps } from './AppThemeProvider.types'

const fontFamily = "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'ddex-color-scheme',
})

const theme = createTheme({
  primaryColor: 'violet',
  defaultRadius: 'lg',
  fontFamily,
  headings: {
    fontFamily,
  },
  components: {
    Paper: {
      defaultProps: {
        radius: 'xl',
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
  },
})

export function AppThemeProvider({ children }: AppThemeProviderProps) {
  return (
    <MantineProvider
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="light"
      theme={theme}
    >
      <div className={styles.viewport}>{children}</div>
    </MantineProvider>
  )
}

/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_URL?: string
  readonly VITE_TESTNET_FOG_REPORT_URL?: string
  readonly VITE_MAINNET_FOG_REPORT_URL?: string
  readonly VITE_TESTNET_FOG_AUTHORITY_SPKI?: string
  readonly VITE_MAINNET_FOG_AUTHORITY_SPKI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

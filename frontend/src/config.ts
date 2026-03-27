interface FogConfig {
  readonly fogReportUrl: string
  readonly fogAuthoritySpki: Uint8Array
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes
}

export const FOG_CONFIG: FogConfig = {
  fogReportUrl: import.meta.env.VITE_MAINNET_FOG_REPORT_URL ?? 'fog://fog-rpt-prd.namda.net',
  fogAuthoritySpki: import.meta.env.VITE_MAINNET_FOG_AUTHORITY_SPKI
    ? decodeBase64(import.meta.env.VITE_MAINNET_FOG_AUTHORITY_SPKI)
    : new Uint8Array(),
}
export interface MockActivityItem {
  readonly amount: string
  readonly badge: string
  readonly direction: 'inbound' | 'outbound'
  readonly id: string
  readonly title: string
  readonly when: string
}

export function formatAddress(address: string): string {
  if (!address) {
    return 'No address derived yet'
  }

  if (address.length <= 22) {
    return address
  }

  return `${address.slice(0, 12)}…${address.slice(-10)}`
}

export function createWalletAlias(address: string): string {
  if (!address) {
    return 'Vault Guest'
  }

  const seed = address
    .slice(0, 12)
    .split('')
    .reduce((total, character) => total + character.charCodeAt(0), 0)

  const adjectives = ['Cipher', 'Quiet', 'Nova', 'Stealth', 'Glacier', 'Velvet']
  const nouns = ['Atlas', 'Fox', 'Node', 'Orbit', 'Harbor', 'Comet']

  return `${adjectives[seed % adjectives.length]} ${nouns[seed % nouns.length]}`
}
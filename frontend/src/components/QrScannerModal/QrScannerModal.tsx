import { useCallback, useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import { ActionIcon, Paper, Stack, Text } from '@mantine/core'
import { IconX } from '@tabler/icons-react'

/**
 * Extract a MobileCoin b58 address from a scanned QR value.
 *
 * Handles:
 *  - Raw b58 address (our own QR, other MC wallets)
 *  - mob:///b58address (Signal payment QR)
 *  - mob://b58address (alternate form)
 *  - mobilecoin:///b58address
 *  - Any whitespace padding
 */
function extractMcAddress(raw: string): string {
  const trimmed = raw.trim()

  // Strip known MobileCoin URI prefixes (Signal uses mob:///)
  for (const prefix of ['mob:///', 'mob://', 'mobilecoin:///', 'mobilecoin://']) {
    if (trimmed.startsWith(prefix)) {
      // Take the path portion, strip any query params
      const withoutPrefix = trimmed.slice(prefix.length)
      const address = withoutPrefix.split('?')[0].split('#')[0].trim()
      return address
    }
  }

  return trimmed
}

interface QrScannerModalProps {
  readonly onClose: () => void
  readonly onScan: (value: string) => void
}

export function QrScannerModal({ onClose, onScan }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const [error, setError] = useState('')
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onScanRef.current = onScan }, [onScan])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const handleScan = useCallback((result: QrScanner.ScanResult) => {
    const address = extractMcAddress(result.data)
    if (address) {
      scannerRef.current?.stop()
      onScanRef.current(address)
      onCloseRef.current()
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const scanner = new QrScanner(
      video,
      handleScan,
      {
        preferredCamera: 'environment',
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      },
    )

    scannerRef.current = scanner

    scanner.start().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('permission') || msg.includes('denied')) {
        setError('Camera access denied. Allow camera permissions and try again.')
      } else if (msg.includes('secure context') || msg.includes('HTTPS')) {
        setError('Camera requires HTTPS. Use a secure connection.')
      } else {
        setError(`Camera unavailable: ${msg}`)
      }
    })

    return () => {
      scanner.stop()
      scanner.destroy()
      scannerRef.current = null
    }
  }, [handleScan])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <Paper radius="1.5rem" p="md" style={{ maxWidth: 400, width: '100%', position: 'relative', overflow: 'hidden' }}>
        <Stack gap="sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text fw={700} size="lg">Scan QR Code</Text>
            <ActionIcon aria-label="Close scanner" onClick={onClose} radius="xl" variant="subtle">
              <IconX size={18} />
            </ActionIcon>
          </div>

          {error ? (
            <Text c="red" size="sm" ta="center" py="xl">{error}</Text>
          ) : (
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                width: '100%',
                aspectRatio: '1',
                objectFit: 'cover',
                borderRadius: '1rem',
                background: '#000',
              }}
            />
          )}

          <Text c="dimmed" size="xs" ta="center">
            Point your camera at a MobileCoin address QR code
          </Text>
        </Stack>
      </Paper>
    </div>
  )
}

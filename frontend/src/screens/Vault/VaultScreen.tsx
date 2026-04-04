import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconEye, IconEyeOff, IconRefresh, IconWaveSquare } from '@tabler/icons-react'
import { QuickActions } from '../../components/QuickActions/QuickActions'
import { useKeystoreStore } from '../../stores/keystoreStore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { useWalletStore } from '../../stores/walletStore'
import { useBalanceStore, formatMob } from '../../stores/balanceStore'
import { useTxHistoryStore, formatTxAmount, formatTxTimestamp, txStatusBadge, txTitle } from '../../stores/txHistoryStore'
import styles from './VaultScreen.module.css'

export function VaultScreen() {
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const lastUnlockAt = useKeystoreStore((state) => state.lastUnlockAt)
  const sessionDurationMs = useKeystoreStore((state) => state.sessionDurationMs)
  const amountsHidden = useUiStore((state) => state.amountsHidden)
  const toggleAmountsHidden = useUiStore((state) => state.toggleAmountsHidden)
  const walletAccount = useWalletStore((state) => state.account)
  const balancePicoMob = useBalanceStore((state) => state.balancePicoMob)
  const balanceSyncStatus = useBalanceStore((state) => state.syncStatus)
  const balanceSyncPhase = useBalanceStore((state) => state.syncPhase)
  const balanceSyncError = useBalanceStore((state) => state.syncError)
  const syncBalance = useBalanceStore((state) => state.sync)
  const txRecords = useTxHistoryStore((state) => state.records)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 30_000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  const remainingMinutes = lastUnlockAt
    ? Math.max(0, Math.round((lastUnlockAt + sessionDurationMs - now) / 60_000))
    : null
  // Trigger fog balance sync when account becomes available
  useEffect(() => {
    if (!walletAccount) return

    // Check status imperatively to avoid re-trigger loops
    // (abort resets to idle → reactive dep would re-fire endlessly)
    const store = useBalanceStore.getState()
    if (store.syncStatus === 'syncing') return

    const controller = new AbortController()
    store.sync(walletAccount, controller.signal)

    return () => {
      controller.abort()
    }
  }, [walletAccount])

  // Periodic fog polling for live receive updates (~30s interval)
  useEffect(() => {
    if (!walletAccount) return

    const interval = window.setInterval(() => {
      const store = useBalanceStore.getState()
      if (store.syncStatus !== 'syncing') {
        store.sync(walletAccount).catch(() => {})
      }
    }, 30_000)

    return () => {
      window.clearInterval(interval)
    }
  }, [walletAccount])

  const [expanded, setExpanded] = useState(false)
  const [visibleCount, setVisibleCount] = useState(5)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const PAGE_SIZE = 10

  const visibleHistory = expanded ? txRecords.slice(0, visibleCount) : txRecords.slice(0, 5)
  const hasMore = expanded && visibleCount < txRecords.length
  const balanceDisplay = formatMob(balancePicoMob)
  const balanceText = amountsHidden ? '***.*** MOB' : `${balanceDisplay} MOB`

  // IntersectionObserver for progressive loading when scrolling
  const handleIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0]?.isIntersecting) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, txRecords.length))
    }
  }, [txRecords.length])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !expanded || !hasMore) return

    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [expanded, hasMore, handleIntersect])

  const handleShowAll = () => {
    setExpanded(true)
    setVisibleCount(Math.min(txRecords.length, PAGE_SIZE + 5))
  }

  const handleCollapse = () => {
    setExpanded(false)
    setVisibleCount(5)
  }

  const handleSyncBalance = () => {
    if (walletAccount && balanceSyncStatus !== 'syncing') {
      void syncBalance(walletAccount)
    }
  }

  const syncLabel = balanceSyncStatus === 'syncing'
    ? `${balanceSyncPhase}…`
    : balanceSyncStatus === 'error'
      ? `Sync failed: ${balanceSyncError}`
      : 'Re-sync'

  return (
    <Stack className={styles.root} gap="xl">
      <Paper className={styles.heroCard} p="xl" radius="2rem" withBorder>
        <Stack gap="xl">
          <Text className={styles.sessionText} c="dimmed" size="sm">
            {remainingMinutes !== null ? `Session valid for ${remainingMinutes}m.` : 'Session active in memory.'} {storedVault ? 'Encrypted wallet is stored on this device.' : 'Wallet is currently memory-only until PIN lock is saved.'}
          </Text>
          <div className={styles.heroHeader}>
            <div className={styles.balanceHeader}>
              <Group className={styles.balanceTitleRow} gap="xs" align="center" wrap="nowrap">
                <Text className={styles.balanceLabel}>Total Balance</Text>
                <ActionIcon
                  aria-label={amountsHidden ? 'Show balances and transaction amounts' : 'Hide balances and transaction amounts'}
                  className={styles.visibilityButton}
                  onClick={toggleAmountsHidden}
                  radius="xl"
                  variant="default"
                >
                  {amountsHidden ? <IconEye size={16} /> : <IconEyeOff size={16} />}
                </ActionIcon>
              </Group>
            </div>
          </div>

          

          <div className={styles.balanceRow}>
            <Text className={styles.balanceValue} fw={900}>{balanceText}</Text>
            <div className={styles.syncStatusRow}>
              <ActionIcon
                aria-label={balanceSyncStatus === 'syncing' ? 'Balance sync in progress' : 'Refresh balance'}
                className={`${styles.refreshButton} ${balanceSyncStatus === 'syncing' ? styles.refreshButtonActive : ''}`.trim()}
                disabled={!walletAccount || balanceSyncStatus === 'syncing'}
                onClick={handleSyncBalance}
                radius="xl"
                variant="subtle"
              >
                <IconRefresh className={balanceSyncStatus === 'syncing' ? styles.refreshIconSpinning : styles.refreshIcon} size={22} />
              </ActionIcon>
              <Text c={balanceSyncStatus === 'error' ? 'red' : 'cyan'} className={styles.syncText} size="xs">
                {syncLabel}
              </Text>
            </div>
          </div>
          <QuickActions />
        </Stack>
      </Paper>

      <Paper className={styles.sectionCard} p="xl" radius="2rem" withBorder>
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap">
            <Text className={styles.sectionTitle} fw={800}>Transaction History</Text>
            <ThemeIcon className={styles.historyIcon} color="teal" radius="xl" variant="light"><IconWaveSquare size={18} /></ThemeIcon>
          </Group>
          <div className={styles.historyList}>
            {visibleHistory.length === 0 && (
              <Text c="dimmed" size="sm" ta="center" py="md">
                {balanceSyncStatus === 'syncing' ? 'Scanning fog for transactions…' : 'No transactions yet.'}
              </Text>
            )}
            {visibleHistory.map((record) => (
              <div className={styles.historyItem} key={record.id}>
                <Stack className={styles.historyMeta} gap={2}>
                  <Text className={styles.historyTitle}>{txTitle(record)}</Text>
                  <Text c="dimmed" size="xs">{formatTxTimestamp(record)}</Text>
                </Stack>
                <Stack align="flex-end" className={styles.historyAmount} gap={4}>
                  <Text className={styles.historyValue} fw={800}>{amountsHidden ? '***.*** MOB' : `${formatTxAmount(record)} MOB`}</Text>
                  <Badge color={record.status === 'pending' ? 'yellow' : record.status === 'expired' ? 'red' : record.senderAddressHash ? 'teal' : record.direction === 'sent' ? 'blue' : 'gray'} radius="xl" variant="light">{txStatusBadge(record)}</Badge>
                </Stack>
              </div>
            ))}
            {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          </div>
          {!expanded && txRecords.length > 5 && (
            <Button className={styles.showAllButton} onClick={handleShowAll} radius="xl" variant="subtle">
              Show all ({txRecords.length})
            </Button>
          )}
          {expanded && (
            <Button className={styles.showAllButton} onClick={handleCollapse} radius="xl" variant="subtle">
              {hasMore ? `Showing ${visibleCount} of ${txRecords.length}` : 'Collapse'}
            </Button>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}
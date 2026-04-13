import { Center, Loader, Stack, Text } from '@mantine/core'
import {
  Navigate,
  Outlet,
  useLocation,
} from 'react-router'
import { useAppBootstrap } from './hooks/useAppBootstrap'
import { AppLayout } from './layouts/AppLayout'
import { OnboardLayout } from './layouts/OnboardLayout'
import { useKeystoreStore } from './stores/keystoreStore'
import { getNextIncompleteOnboardingPath, getNextOnboardingPath, useOnboardingStore } from './stores/onboardingStore'
import { useWalletStore } from './stores/walletStore'

function LoadingScreen() {
  return (
    <Center mih="100vh">
      <Stack align="center" gap="sm">
        <Loader color="cyan" size="lg" />
        <Text c="dimmed" size="sm">Booting private wallet systems…</Text>
      </Stack>
    </Center>
  )
}

export function BootstrapOutlet() {
  useAppBootstrap()
  return <Outlet />
}

export function RootRedirect() {
  const walletAddress = useWalletStore((state) => state.address)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const status = useKeystoreStore((state) => state.status)
  const wasmStatus = useWalletStore((state) => state.wasmStatus)
  const nextOnboardingPath = useOnboardingStore(getNextOnboardingPath)

  if (status === 'checking' || wasmStatus === 'loading' || wasmStatus === 'idle') {
    return <LoadingScreen />
  }

  if (walletAddress) {
    if (nextOnboardingPath) {
      return <Navigate replace to={nextOnboardingPath} />
    }

    return <Navigate replace to="/wallet" />
  }

  if (storedVault) {
    return <Navigate replace to="/unlock" />
  }

  return <Navigate replace to="/welcome" />
}

export function ProtectedAppOutlet() {
  const location = useLocation()
  const walletAddress = useWalletStore((state) => state.address)
  const status = useKeystoreStore((state) => state.status)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const wasmStatus = useWalletStore((state) => state.wasmStatus)
  const nextOnboardingPath = useOnboardingStore(getNextOnboardingPath)

  if (status === 'checking' || wasmStatus === 'loading' || wasmStatus === 'idle') {
    return <LoadingScreen />
  }

  if (walletAddress) {
    if (nextOnboardingPath && location.pathname !== nextOnboardingPath) {
      return <Navigate replace to={nextOnboardingPath} />
    }

    return <AppLayout />
  }

  if (storedVault) {
    return <Navigate replace to="/unlock" />
  }

  return <Navigate replace to="/welcome" />
}

export function PublicOutlet() {
  const location = useLocation()
  const walletAddress = useWalletStore((state) => state.address)
  const status = useKeystoreStore((state) => state.status)
  const storedVault = useKeystoreStore((state) => state.storedVault)
  const nextOnboardingPath = useOnboardingStore(getNextOnboardingPath)
  const nextIncompleteOnboardingPath = useOnboardingStore(getNextIncompleteOnboardingPath)

  if (status === 'checking') {
    return <LoadingScreen />
  }

  if (walletAddress) {
    const canStayOnBackupCheck = (
      (nextOnboardingPath === '/onboard/backup' || nextIncompleteOnboardingPath === '/onboard/backup')
      && location.pathname === '/onboard/backup-check'
    )

    if (nextOnboardingPath) {
      if (location.pathname !== nextOnboardingPath && !canStayOnBackupCheck) {
        return <Navigate replace to={nextOnboardingPath} />
      }

      return <OnboardLayout />
    }

    if (nextIncompleteOnboardingPath && (location.pathname === nextIncompleteOnboardingPath || canStayOnBackupCheck)) {
      return <OnboardLayout />
    }

    return <Navigate replace to="/wallet" />
  }

  if (storedVault && location.pathname !== '/unlock' && !location.pathname.startsWith('/debug/wasm')) {
    return <Navigate replace to="/unlock" />
  }

  return <OnboardLayout />
}
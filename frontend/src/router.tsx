import { Navigate, createBrowserRouter } from 'react-router'
import {
  BootstrapOutlet,
  ProtectedAppOutlet,
  PublicOutlet,
  RootRedirect,
} from './routeGuards'
import { ProfileScreen } from './screens/Profile/ProfileScreen'
import { RecoveryPhraseScreen } from './screens/Profile/RecoveryPhraseScreen'
import { BackupMnemonicScreen } from './screens/Onboard/BackupMnemonicScreen'
import { BackupMnemonicValidationScreen } from './screens/Onboard/BackupMnemonicValidationScreen'
import { CreatePassphraseScreen } from './screens/Onboard/CreatePassphraseScreen'
import { CreateWalletScreen } from './screens/Onboard/CreateWalletScreen'
import { EnableBiometricsScreen } from './screens/Onboard/EnableBiometricsScreen'
import { ImportWalletScreen } from './screens/Onboard/ImportWalletScreen'
import { OnboardCompleteScreen } from './screens/Onboard/OnboardCompleteScreen'
import { TransferScreen } from './screens/Transfer/TransferScreen'
import { ReceiveScreen } from './screens/Transfer/ReceiveScreen'
import { AppErrorScreen } from './screens/Error/AppErrorScreen'
import { UnlockScreen } from './screens/Unlock/UnlockScreen'
import { VaultScreen } from './screens/Vault/VaultScreen'
import { SettingsScreen } from './screens/Settings/SettingsScreen'
import { WelcomeScreen } from './screens/Welcome/WelcomeScreen'
import { WasmTestIndex } from './screens/Test/WasmTestIndex'
import { WasmKeysTest } from './screens/Test/WasmKeysTest'
import { WasmTxTest } from './screens/Test/WasmTxTest'
import { WasmSCITest } from './screens/Test/WasmSCITest'
import { WasmSCIE2ETest } from './screens/Test/WasmSCIE2ETest'

export const router = createBrowserRouter([
  {
    errorElement: <AppErrorScreen />,
    path: '/',
    element: <BootstrapOutlet />,
    children: [
      { index: true, element: <RootRedirect /> },
      {
        element: <PublicOutlet />,
        children: [
          { path: 'welcome', element: <WelcomeScreen /> },
          { path: 'unlock', element: <UnlockScreen /> },
          { path: 'onboard/create', element: <CreateWalletScreen /> },
          { path: 'onboard/import', element: <ImportWalletScreen /> },
          { path: 'onboard/backup', element: <BackupMnemonicScreen /> },
          { path: 'onboard/backup-check', element: <BackupMnemonicValidationScreen /> },
          { path: 'onboard/pin', element: <CreatePassphraseScreen /> },
          { path: 'onboard/biometrics', element: <EnableBiometricsScreen /> },
          { path: 'onboard/complete', element: <OnboardCompleteScreen /> },
          { path: 'debug/wasm', element: <WasmTestIndex /> },
          { path: 'debug/wasm/keys', element: <WasmKeysTest /> },
          { path: 'debug/wasm/tx', element: <WasmTxTest /> },
          { path: 'debug/wasm/sci', element: <WasmSCITest /> },
          { path: 'debug/wasm/sci-e2e', element: <WasmSCIE2ETest /> },
        ],
      },
      {
        element: <ProtectedAppOutlet />,
        children: [
          { path: 'wallet', element: <VaultScreen /> },
          { path: 'transfer', element: <Navigate replace to="/transfer/send" /> },
          { path: 'transfer/send', element: <TransferScreen /> },
          { path: 'transfer/receive', element: <ReceiveScreen /> },
          { path: 'profile', element: <ProfileScreen /> },
          { path: 'settings', element: <SettingsScreen /> },
          { path: 'settings/recovery-phrase', element: <RecoveryPhraseScreen /> },
        ],
      },
    ],
  },
])
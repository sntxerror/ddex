import { createBrowserRouter } from 'react-router'
import {
  BootstrapOutlet,
  ProtectedAppOutlet,
  PublicOutlet,
  RootRedirect,
} from './routeGuards'
import { ProfileScreen } from './screens/Profile/ProfileScreen'
import { RecoveryPhraseScreen } from './screens/Profile/RecoveryPhraseScreen'
import { NetworkSettingsScreen } from './screens/Profile/NetworkSettingsScreen'
import { BackupMnemonicScreen } from './screens/Onboard/BackupMnemonicScreen'
import { CreatePassphraseScreen } from './screens/Onboard/CreatePassphraseScreen'
import { CreateWalletScreen } from './screens/Onboard/CreateWalletScreen'
import { EnableBiometricsScreen } from './screens/Onboard/EnableBiometricsScreen'
import { ImportWalletScreen } from './screens/Onboard/ImportWalletScreen'
import { OnboardCompleteScreen } from './screens/Onboard/OnboardCompleteScreen'
import { TransferScreen } from './screens/Transfer/TransferScreen'
import { ReceiveScreen } from './screens/Transfer/ReceiveScreen'
import { UnlockScreen } from './screens/Unlock/UnlockScreen'
import { VaultScreen } from './screens/Vault/VaultScreen'
import { WelcomeScreen } from './screens/Welcome/WelcomeScreen'

export const router = createBrowserRouter([
  {
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
          { path: 'onboard/passphrase', element: <CreatePassphraseScreen /> },
          { path: 'onboard/biometrics', element: <EnableBiometricsScreen /> },
          { path: 'onboard/complete', element: <OnboardCompleteScreen /> },
        ],
      },
      {
        element: <ProtectedAppOutlet />,
        children: [
          { path: 'vault', element: <VaultScreen /> },
          { path: 'transfer', element: <TransferScreen /> },
          { path: 'transfer/receive', element: <ReceiveScreen /> },
          { path: 'profile', element: <ProfileScreen /> },
          { path: 'profile/recovery-phrase', element: <RecoveryPhraseScreen /> },
          { path: 'profile/network', element: <NetworkSettingsScreen /> },
        ],
      },
    ],
  },
])
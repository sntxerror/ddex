# Changelog

## Unreleased

### Changed

- Replaced the old frontend-owned WASM artifact flow with a proper pnpm workspace package in `wasm/`.
- Switched the frontend to consume `@ddex/wallet-core-web` directly instead of importing generated files from `frontend/src/wasm`.
- Updated CI to build `wasm/pkg/`, pass it between jobs as an artifact, and run workspace commands from the repo root.
- Standardized root developer commands around `pnpm build:wasm`, `pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm typecheck`.
- Migrated the active app UI from the retired Game of Life demo to a wallet-first preview built with Mantine and CSS Modules.
- Expanded the wallet preview into a route-driven app experience with onboarding, unlock, protected app routes, error handling, and tabbed in-app navigation.
- Tightened TypeScript and ESLint configuration for strict-mode frontend development.
- Refactored the new DDEX dashboard shell into smaller focused components so the main app file stays readable and easier to extend.
- Replaced the root `pnpm dev` concurrency wrapper with `scripts/run-dev.mjs` so proxy/frontend startup and shutdown are coordinated more gracefully.
- Added a `stop_grace_period` to the proxy compose service to reduce noisy shutdown behavior during local dev restarts.
- Refined wallet UX copy and layouts across onboarding, profile, vault, and settings to emphasize security status, clearer labels, and simpler flows.

### Added

- Root `package.json` and `pnpm-workspace.yaml` to define a real JS workspace.
- `wasm/package.json` as the browser-facing workspace package boundary.
- `wasm/index.ts` as the stable wrapper around generated wallet-core artifacts.
- Mantine theme/provider setup and structured component folders under `frontend/src/components/`.
- `frontend/src/hooks/useWalletDashboard.ts` and `frontend/src/hooks/useWalletDashboard.types.ts` to centralize wallet/vault orchestration outside the page shell.
- `frontend/src/components/AppHeader/`, `OverviewPanel/`, `AddressDetailsPanel/`, `SettingsGuidePanel/`, and `ViewIntro/` to break the dashboard into smaller UI blocks.
- `frontend/src/types/appShell.ts` for shared view/navigation typing.
- `scripts/run-dev.mjs` as a custom root dev entrypoint that builds WASM first, then runs proxy and frontend with coordinated shutdown.
- This `CHANGELOG.md` documents architectural and developer-experience changes.
- Route-level frontend architecture under `frontend/src/router.tsx` and `frontend/src/routeGuards.tsx`.
- App shell layouts with dedicated onboarding and authenticated contexts (`frontend/src/layouts/AppLayout.tsx`, `frontend/src/layouts/OnboardLayout.tsx`).
- New wallet product screens for welcome, create/import wallet, recovery backup, PIN setup, biometric step, onboarding completion, unlock, vault, transfer/receive, profile, and settings.
- Security-oriented state and flows via new stores and hooks (`keystoreStore`, `onboardingStore`, `uiStore`, `networkStore`, `transferStore`, `walletStore`, `useSecurityScore`, `useAutoLock`, `useAppBootstrap`).
- Reusable wallet UI primitives including `BottomTabBar`, `QuickActions`, `SecurityScoreCard`, and `WarningBanner`.

### Removed

- Legacy sync/copy workflow that pushed generated files into `frontend/src/wasm` and `frontend/public/wasm`.
- Stale generated frontend-side WASM glue files and copied public `.wasm` artifacts.
- Old proof-of-concept proxy log / Game of Life app wiring from the active frontend entry path.

### Fixed

- Onboarding continuity issues so re-entry from security reminders routes users through incomplete steps more reliably.
- Profile and onboarding rendering regressions introduced during recent UI reshaping (including JSX/layout and theme consistency issues).
- Minor frontend copy and settings polish regressions addressed in follow-up commits.

### Notes

- Frontend `pnpm lint`, `pnpm typecheck`, and `pnpm build` are passing after the dashboard-shell refactor.
- `frontend/src/App.tsx` now acts as a coordinator rather than an all-in-one screen implementation.

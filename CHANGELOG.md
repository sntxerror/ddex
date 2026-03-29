# Changelog

## Unreleased

### Added — Transaction Sending

- `frontend/src/services/consensusClient.ts` — attested Consensus client: network status, Merkle proofs, ring member sampling, fog report fetching, and `proposeTx` submission via Noise NX session.
- `frontend/src/services/txBuilder.ts` — `sendTransaction()` orchestrator: coin selection (largest-first), ring construction (11 mixins), WASM `buildTransaction` call, and consensus submission with verbose `[txSend]` logging.
- `crates/wallet-core/src/prost_verify.rs` — ring signature and Bulletproof validation helpers (prost-based).
- WASM `buildTransaction`, `decodeB58Address`, `deriveSubaddress` exports in `wasm/index.ts`.
- Full MLSAG ring-signature and Bulletproof range-proof generation in Rust `crates/wallet-core/src/transaction.rs`.

### Changed — Fog Sync Pagination (MC Reference Algorithm)

- **Rewrote `fogClient.ts`** to match MobileCoin's reference `polling.rs` exponential-search algorithm:
  - Two-phase approach: active RNGs first (fast initial balance), then decommissioned RNGs (historical completeness).
  - Exponential key doubling per round (1→2→4→8…), capped at `500 / liveCursors` (gRPC message size limit).
  - Dead-RNG detection: if an RNG returns fewer results than requested, it stops being queried.
  - Previous flat `SEARCH_KEY_BATCH_SIZE=5` caused balance invisibility when an RNG had 6+ TxOuts (root cause of the missing 9.97 MOB change output).
- `balanceStore.ts` now accepts an `onResult` progressive callback, updating the UI with running balance after each exponential round instead of waiting for full scan completion.
- `fogClient.ts.bak` preserved as reference of the pre-rewrite version.

### Fixed — Transaction Wire Format

- `Range.from`/`Range.to` and `TxOutMembershipProof` fields now encode as `uint64` (varint wire type 0), not `fixed64` (wire type 1). Mismatched wire types caused silent consensus rejection.
- Fog hint size corrected to 84 bytes (82 encrypted + 2 magic bytes), not 82.
- `e_memo` field omitted when empty (not all TxOuts carry encrypted memos).
- `ProposeTxResponse` from consensus is plaintext (not AES-encrypted) — use `encryptedCallPlaintextResponse()`.

### Added — Debug Logging

- `[fog][P1]`/`[fog][P2]` phase-prefixed logging in `fogClient.ts` for RNG record counts, per-round key generation, Found/NotFound tallies, running balance, and dead-RNG detection.
- `[scan]` logging in WASM `scanning.rs` with `to_hex()` helper: shared_secret, candidate_D, each D_i with MATCH indicator.
- `[txSend]` logging in `txBuilder.ts`: recipient decode, coin selection detail, network status, fog ingest pubkey, submit result.

### Added — Fog Balance Sync

- End-to-end Fog balance sync pipeline: attest → query RNG records → derive KexRng search keys → query TxOuts → decrypt VersionedCryptoBox → decode TxOutRecord → scan for ownership → check key images → sum unspent balance.
- `frontend/src/services/fogClient.ts` — full Fog sync orchestrator with retry logic, abort-signal support, and progress callbacks.
- `frontend/src/lib/attested.ts` — Noise NX handshake (`Noise_NX_25519_AESGCM_SHA512`) implementation for attested gRPC connections to Fog enclaves.
- `frontend/src/lib/grpc.ts` — minimal gRPC-Web framing (encode/decode length-delimited frames with compression byte).
- `frontend/src/lib/mc-proto.ts` — hand-rolled protobuf encoder/decoder for MobileCoin Fog messages (QueryRequest, QueryResponse, TxOutRecord, CheckKeyImages).
- `frontend/src/stores/balanceStore.ts` — Zustand store for balance state, sync status, and `formatMob()` display helper.
- New WASM exports in `wasm/index.ts`: `deriveKexRngSearchKeys`, `decryptFogCiphertext`, `scanTxOut`, `computeKeyImage`.
- Wallet-core Rust additions in `crates/wallet-core/src/scanning.rs`: VersionedCryptoBox decryption (footer format), AmountV2 unmasking (HKDF-SHA512 + XOR), Pedersen commitment verification, key-image derivation.
- Balance display on `VaultScreen` with picoMOB → MOB formatting and sync-phase progress indicator.
- Fog authority SPKI and report URL environment variables in `.env.example`.

### Changed

- Simplified Fog configuration to mainnet-only (`frontend/src/config.ts` exports a single `FOG_CONFIG` constant).
- Envoy proxy route timeouts increased to 120s for long-running Fog queries.
- `walletStore` now uses `FOG_CONFIG` for fog report URL and SPKI during key derivation, producing addresses that match Signal's for the same mnemonic.
- Coerced `serde_wasm_bindgen` return values through `BigInt()` to handle Rust u64 values that arrive as JS Number (small values like `token_id = 0`) instead of BigInt.
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
- Tightened the authenticated app shell and settings layouts around a shared `56rem` desktop width, including header/footer framing and edge-aligned header controls after removing the title.
- Reworked settings, warning, receive, and recovery phrase screens to use more compact wallet-first layouts, quieter feedback rows, and a consistent destructive-state visual treatment.
- Merged PIN management into the Privacy & Security section, standardized onboarding action button sizing, and refreshed onboarding copy to emphasize zero-custody messaging.
- Recovery phrase presentation now uses numbered word layouts for readability while keeping clipboard copies normalized to plain space-separated mnemonic text.

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
- Shared frontend helpers for secure UX polish, including a reusable `PinInputField`, `RecoveryPhraseBlock`, and `useCopyFeedback` clipboard tooltip flow.
- A dedicated onboarding backup verification step at `/onboard/backup-check` that asks the user to confirm random recovery phrase words before finishing setup.
- Persisted hidden-balance and biometric-preference state so vault privacy/security choices survive across app restarts.

### Removed

- Legacy sync/copy workflow that pushed generated files into `frontend/src/wasm` and `frontend/public/wasm`.
- Stale generated frontend-side WASM glue files and copied public `.wasm` artifacts.
- Old proof-of-concept proxy log / Game of Life app wiring from the active frontend entry path.

### Fixed

- Onboarding continuity issues so re-entry from security reminders routes users through incomplete steps more reliably.
- Profile and onboarding rendering regressions introduced during recent UI reshaping (including JSX/layout and theme consistency issues).
- Minor frontend copy and settings polish regressions addressed in follow-up commits.
- Backup verification routing now remains resumable after dismissing onboarding once, preventing users from getting stuck before completing recovery phrase confirmation.
- Wallet settings no longer surface routine keystore/session success strings in the feedback row, reducing noisy status text like session-duration and encrypted-device notices.
- Header action alignment regressions after removing the app title and several input/copy-control consistency issues across unlock, onboarding, and settings flows.

### Notes

- Frontend `pnpm lint`, `pnpm typecheck`, and `pnpm build` are passing after the dashboard-shell refactor.
- `frontend/src/App.tsx` now acts as a coordinator rather than an all-in-one screen implementation.

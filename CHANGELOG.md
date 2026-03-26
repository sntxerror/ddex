# Changelog

## Unreleased

### Changed

- Replaced the old frontend-owned WASM artifact flow with a proper pnpm workspace package in `wasm/`.
- Switched the frontend to consume `@ddex/wallet-core-web` directly instead of importing generated files from `frontend/src/wasm`.
- Updated CI to build `wasm/pkg/`, pass it between jobs as an artifact, and run workspace commands from the repo root.
- Standardized root developer commands around `pnpm build:wasm`, `pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm typecheck`.
- Migrated the active app UI from the retired Game of Life demo to a wallet-first preview built with Mantine and CSS Modules.
- Tightened TypeScript and ESLint configuration for strict-mode frontend development.

### Added

- Root `package.json` and `pnpm-workspace.yaml` to define a real JS workspace.
- `wasm/package.json` as the browser-facing workspace package boundary.
- `wasm/index.ts` as the stable wrapper around generated wallet-core artifacts.
- Mantine theme/provider setup and structured component folders under `frontend/src/components/`.
- This `CHANGELOG.md` documents architectural and developer-experience changes.

### Removed

- Legacy sync/copy workflow that pushed generated files into `frontend/src/wasm` and `frontend/public/wasm`.
- Stale generated frontend-side WASM glue files and copied public `.wasm` artifacts.
- Old proof-of-concept proxy log / Game of Life app wiring from the active frontend entry path.

### Notes

- Root `pnpm lint` and `pnpm typecheck` are passing.
- End-to-end validation of `pnpm build:wasm` still requires an environment with `wasm-pack` installed.

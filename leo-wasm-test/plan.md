# Phase 1: Project Skeleton - Implementation Plan

## Current state

- Rust workspace with `crates/wallet-core` (dummy WASM crate using `wasm-bindgen`)
- Pre-built WASM output in `packages/wallet-core-wasm/` (via `wasm-pack`)
- `research.md` with verified MobileCoin testnet/mainnet endpoints and enclave measurements
- GitHub repo `sntxerror/ddex` created, remote configured

## Remaining deliverables

### 1. Frontend app (Vite + React + TypeScript)

Create `packages/frontend/` with:

- Vite configured for React + TypeScript
- WASM loading via `vite-plugin-wasm` and `vite-plugin-top-level-await`
- Import `wallet-core` WASM package from `../wallet-core-wasm`
- On app load: call `init()` and `version()`, display result in the UI
- Environment config for testnet/mainnet endpoints (`VITE_FOG_URL`, `VITE_CONSENSUS_URL`, etc.)
- ESLint + Prettier setup
- Tailwind CSS for styling

Files to create:

```
packages/frontend/
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  index.html
  tailwind.config.js
  postcss.config.mjs
  .eslintrc.cjs
  .prettierrc
  src/
    main.tsx
    App.tsx
    App.css
    vite-env.d.ts
    config/
      env.ts           # endpoint config per network
  public/
    favicon.ico
```

Verification: `npm run dev` starts, page loads, shows "wallet-core WASM module loaded successfully".

### 2. Monorepo tooling

Root-level workspace config:

- Root `package.json` with npm workspaces pointing to `packages/*`
- Shared dev scripts: `dev`, `build`, `lint`, `test`
- `.nvmrc` or `engines` field to pin Node version
- `.gitignore` updated for node_modules, dist, .env files

Files to create/update:

```
package.json           # root workspace
.gitignore             # Node + Rust ignores
.nvmrc                 # Node version
```

### 3. Local gRPC-Web proxy (Envoy)

Browsers cannot call native gRPC. Set up Envoy as a local proxy:

- gRPC-Web (HTTP/1.1) from browser -> native gRPC (HTTP/2) to MobileCoin Fog
- Stateless, no keys, no user data

Target endpoints (testnet):

| Service | Upstream |
| --- | --- |
| Fog gateway | `fog.test.mobilecoin.com:443` |
| Consensus node 1 | `node1.test.mobilecoin.com:443` |
| Consensus node 2 | `node2.test.mobilecoin.com:443` |

Files to create:

```
proxy/
  envoy.yaml           # Envoy config: gRPC-Web -> gRPC
  Dockerfile           # Envoy image with config baked in
  docker-compose.yml   # start proxy locally
```

Verification: `docker compose up` starts Envoy on `localhost:8080`, a curl to the proxy returns a gRPC response header from Fog.

### 4. CI pipeline (GitHub Actions)

Workflow: `.github/workflows/ci.yml`

Jobs:

- **lint** - ESLint on frontend code
- **test-frontend** - Vitest unit tests
- **test-rust** - `cargo test` on wallet-core
- **build-wasm** - `wasm-pack build` to verify WASM compiles
- **build-frontend** - `npm run build` to verify Vite production build

Trigger on: push to `main`, pull requests.

Files to create:

```
.github/
  workflows/
    ci.yml
```

### 5. Verify testnet accessibility

Prove the proxy can reach MobileCoin testnet:

- curl the Envoy proxy endpoint and confirm gRPC response headers from Fog
- curl the S3 tx-source archive and confirm 200 OK
- curl the enclave distribution endpoint and confirm JSON response
- Document results

## Task sequence

1. Create root `package.json`, `.gitignore`, `.nvmrc`
2. Scaffold `packages/frontend/` with Vite + React + TS + Tailwind
3. Wire WASM import into frontend, verify `init()` works in browser
4. Create `proxy/` with Envoy config and docker-compose
5. Test proxy against testnet with curl
6. Create `.github/workflows/ci.yml`
7. Run full lint + test + build locally to verify
8. Commit and push

## Done when

- `npm run dev` in frontend starts Vite, page loads, WASM `init()` result displayed
- `docker compose -f proxy/docker-compose.yml up` starts Envoy, proxy reaches Fog testnet
- `npm run lint` and `npm run test` pass
- CI pipeline runs on push to main

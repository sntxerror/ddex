# Dreamer's DEX

Non-custodial MobileCoin web wallet and DEX.

## Structure

```text
ddex/
  artifacts/           # LLM artifacts, researches, and generated docs (gitignored, local only)
  crates/
    wallet-core/       # Rust WASM library (MobileCoin crypto: key derivation, Fog decrypt, amount unmasking)
  frontend/            # React + TypeScript + Vite web app
  proxy/               # Envoy gRPC-Web proxy (see proxy/README.md)
  wasm/                # Workspace package for the browser wallet-core build
```

## Prerequisites

- **Node.js** >= 22 (LTS)
- **pnpm** >= 10 (via `corepack enable` recommended)
- **Docker** (for the Envoy proxy)
- **Rust** 1.88.0 with `wasm32-unknown-unknown` target
- **wasm-pack**

## Toolchain setup

```bash
corepack enable
pnpm install
pnpm run setup:rust
```

The repository pins Rust in `rust-toolchain.toml`, and `pnpm run setup:rust` installs:

- the pinned Rust toolchain
- the `wasm32-unknown-unknown` target
- `wasm-pack`

CI uses the same pinned Rust toolchain and `wasm-pack`, so local builds and CI stay in lockstep.

### 1. Build the WASM module

```bash
pnpm build:wasm
```

### 2. Install frontend dependencies

```bash
pnpm install
```

### 3. Start the Envoy proxy

```bash
cd proxy
docker compose up --build -d
./test.sh  # verify all 4 routes
```

See [proxy/README.md](proxy/README.md) for full architecture docs.

### 4. Start development server

```bash
pnpm dev
```

The root `pnpm dev` command first builds the `@ddex/wallet-core-web` workspace package in `wasm/pkg/`, then starts the frontend. The frontend imports the workspace package directly instead of copying generated files into `frontend/src/`.

The Vite dev server starts at `http://localhost:5173`. The Envoy proxy at `:8080` handles gRPC-Web routing to MobileCoin Fog and Consensus services:

| Path | Target | Purpose |
| --- | --- | --- |
| `/prod/fog/*` | `fog.prod.mobilecoinww.com` | Mainnet Fog (view, ledger, key-image) |
| `/prod/consensus/*` | `node1.prod.mobilecoinww.com` | Mainnet Consensus proxy |
| `/test/fog/*` | `fog.test.mobilecoin.com` | Testnet Fog gRPC-Web proxy |
| `/test/consensus/*` | `node1.test.mobilecoin.com` | Testnet Consensus proxy |

### Fog balance sync

The wallet performs a full Fog sync loop on unlock:

1. Noise NX handshake (attestation) with Fog View enclave
2. Query for KexRng records → derive search keys in WASM
3. Query Fog View with search keys → decrypt VersionedCryptoBox ciphertexts
4. Decode TxOutRecord protobuf → scan for ownership and unmask amounts in WASM
5. Check key images against Fog Ledger for spent detection
6. Sum unspent MOB TxOuts = displayed balance

## Development

### Rebuild WASM after Rust changes

```bash
pnpm build:wasm
```

If the Rust toolchain has not been installed yet, run:

```bash
pnpm run setup:rust
```

### Run Rust tests

```bash
cargo test --workspace
```

### Lint and type-check frontend

```bash
pnpm lint
pnpm typecheck
```

See [`wasm/README.md`](wasm/README.md) for the detailed workspace-package build workflow.

## Artifacts

The `artifacts/` directory is for local-only LLM-generated documents (plans, handoffs, research notes, etc.). It is gitignored — only the `.gitkeep` is tracked so the folder exists after clone.

Put any AI/LLM session artifacts here to keep the repo clean.

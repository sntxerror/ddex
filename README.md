# Dreamer's DEX

Non-custodial MobileCoin web wallet and DEX.

## Structure

```
ddex/
  artifacts/           # LLM-generated docs (gitignored, local only)
  crates/
    wallet-core/       # Rust WASM library (MobileCoin crypto operations)
  packages/
    wallet-core-wasm/  # Generated WASM package (built by wasm-pack)
  frontend/            # React + TypeScript + Vite web app
  proxy/               # Envoy gRPC-Web proxy (see proxy/README.md)
```

## Prerequisites

- **Node.js** >= 22 (LTS)
- **Docker** (for the Envoy proxy)
- **Rust** (stable) with `wasm32-unknown-unknown` target
- **wasm-pack**

## Quick start

```bash
npm install -g wasm-pack
# or
cargo install wasm-pack
```


### 1. Build the WASM module

```bash
wasm-pack build crates/wallet-core --target web --out-dir ../../packages/wallet-core-wasm
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
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
cd frontend
npm run dev
```

The Vite dev server starts at `http://localhost:5173` with proxies:

| Path | Target | Purpose |
| --- | --- | --- |
| `/test/fog/*` | `fog.test.mobilecoin.com` | Testnet Fog gRPC-Web proxy |
| `/test/consensus/*` | `node1.test.mobilecoin.com` | Testnet Consensus proxy |
| `/prod/fog/*` | `fog.prod.mobilecoinww.com` | Mainnet Fog gRPC-Web proxy |
| `/prod/consensus/*` | `node1.prod.mobilecoinww.com` | Mainnet Consensus proxy |

## Development

### Rebuild WASM after Rust changes

```bash
wasm-pack build crates/wallet-core --target web --out-dir ../../packages/wallet-core-wasm
```

### Run Rust tests

```bash
cargo test --workspace
```

### Lint and type-check frontend

```bash
cd frontend
npm run lint
npx tsc -b --noEmit
```

## Artifacts

The `artifacts/` directory is for local-only LLM-generated documents (plans, handoffs, research notes, etc.). It is gitignored — only the `.gitkeep` is tracked so the folder exists after clone.

Put any AI/LLM session artifacts here to keep the repo clean.

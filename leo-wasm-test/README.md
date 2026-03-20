# Dreamer's DEX

Non-custodial MobileCoin web wallet and DEX.

## Structure

```
ddex/
  crates/
    wallet-core/       # Rust WASM library (MobileCoin crypto operations)
  packages/
    wallet-core-wasm/  # Generated WASM package (built by wasm-pack)
  frontend/            # React + TypeScript + Vite web app
  research.md          # MobileCoin network endpoint research
```

## Prerequisites

- **Node.js** >= 24
- **Rust** (stable) with `wasm32-unknown-unknown` target
- **wasm-pack** (`npm install -g wasm-pack` or `cargo install wasm-pack`)

## Quick start

### 1. Build the WASM module

```bash
wasm-pack build crates/wallet-core --target web --out-dir ../../packages/wallet-core-wasm
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
```

### 3. Start development server

```bash
npm run dev
```

The Vite dev server starts at `http://localhost:5173` with proxies:

| Path | Target | Purpose |
| --- | --- | --- |
| `/fog` | `fog.test.mobilecoin.com` | Fog gRPC-Web proxy |
| `/consensus` | `node1.test.mobilecoin.com` | Consensus node proxy |

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

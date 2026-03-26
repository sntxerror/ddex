# WASM workspace package

This folder is the workspace package that exposes the browser-facing `wallet-core` API to the frontend.

## What lives here

`wasm-pack` emits the assembled browser package into `ddex/wasm/pkg/` with a stable output name:

```bash
wasm-pack build ../crates/wallet-core --target web --out-dir ./pkg --out-name wallet_core
```

That produces the generated browser package files consumed by the wrapper in this folder:

- `wallet_core.js`
- `wallet_core.d.ts`
- `wallet_core_bg.wasm`
- `wallet_core_bg.wasm.d.ts`

## Frontend integration

The frontend depends on this folder as a pnpm workspace package:

- package name: `@ddex/wallet-core-web`
- runtime wrapper: `wasm/index.ts`
- generated output: `wasm/pkg/`

The frontend imports this package directly instead of importing generated files from `frontend/src/wasm` or copying `.wasm` files into `frontend/public/wasm`.

Current build command:

```bash
pnpm --filter @ddex/wallet-core-web build
```

## Typical workflow

1. Rebuild the canonical package after Rust changes:

   ```bash
   pnpm build:wasm
   ```

2. Start or build the frontend:

   ```bash
   pnpm dev
   ```

   or

   ```bash
   pnpm build
   ```

3. The root scripts build this workspace package first, and the frontend imports it directly.

## Wrapper behavior

`wasm/index.ts` provides the stable JS/TS contract used by the frontend.

- It lazily loads `./pkg/wallet_core.js`
- It keeps lint/typecheck working even before `wasm/pkg/` exists
- It throws a clear runtime error if the generated package is missing

This means `wasm/pkg/` remains generated output, while `wasm/index.ts` remains the human-maintained boundary.

## CI behavior

CI builds the WASM package into `wasm/pkg/`, uploads that directory as an artifact, downloads it in the frontend job, and then runs the frontend against the same workspace package boundary used locally.

## Notes

- `wasm/pkg/` is generated output and is gitignored.
- Keeping a stable `--out-name wallet_core` avoids import churn when the Rust crate name changes.
- If the frontend cannot initialize the package at runtime, rebuild `wasm/pkg/` first with `pnpm build:wasm`.

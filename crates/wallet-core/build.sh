#!/usr/bin/env bash
set -euo pipefail
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/wasm.wasm --out-dir pkg --target web
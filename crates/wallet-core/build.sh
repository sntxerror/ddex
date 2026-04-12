#!/usr/bin/env bash
set -euo pipefail

# Auto-install matching wasm-bindgen-cli if needed
REQUIRED_VERSION="0.2.114"
INSTALLED_VERSION=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || echo "")
if [ "$INSTALLED_VERSION" != "$REQUIRED_VERSION" ]; then
  echo "Installing wasm-bindgen-cli $REQUIRED_VERSION (found: ${INSTALLED_VERSION:-none})..."
  cargo install -f wasm-bindgen-cli --version "$REQUIRED_VERSION"
fi

# Build the project
cargo build --target wasm32-unknown-unknown --release
# Generate JavaScript bindings
wasm-bindgen target/wasm32-unknown-unknown/release/wasm.wasm --out-dir pkg --target web
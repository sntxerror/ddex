#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLCHAIN="$(awk -F '"' '/channel = / { print $2 }' "$REPO_ROOT/rust-toolchain.toml")"

if ! command -v curl >/dev/null 2>&1; then
  echo "[setup:rust] curl is required to install rustup." >&2
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "[setup:rust] installing rustup..."
  curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain "$TOOLCHAIN"
fi

export PATH="$HOME/.cargo/bin:$PATH"

echo "[setup:rust] syncing toolchain $TOOLCHAIN..."
rustup toolchain install "$TOOLCHAIN" --profile minimal
rustup default "$TOOLCHAIN"
rustup target add wasm32-unknown-unknown --toolchain "$TOOLCHAIN"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "[setup:rust] installing wasm-pack..."
  cargo install wasm-pack --locked
else
  echo "[setup:rust] wasm-pack already installed"
fi

echo "[setup:rust] done"
rustc --version
cargo --version
wasm-pack --version

#!/usr/bin/env bash
set -euo pipefail

sep() { echo ""; echo "────────────────────────────────────────"; }

sep
echo "==> [1/5] Enabling corepack and installing pnpm..."
sep
corepack enable
PNPM_VERSION=$(node -p "require('./package.json').packageManager.split('@')[1]")
echo "Preparing pnpm@${PNPM_VERSION}..."
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@${PNPM_VERSION}" --activate

sep
echo "==> [2/5] Copying .env..."
sep
if [ -f .env ]; then
  echo ".env already exists, skipping."
else
  cp .env.example .env
  echo "Copied .env.example -> .env"
fi

sep
echo "==> [3/5] Installing pnpm dependencies..."
sep
pnpm install

sep
echo "==> [4/5] Setting up Rust toolchain (1.88.0 + wasm32 + wasm-pack)..."
sep
bash scripts/setup-rust.sh

sep
echo "==> [5/5] Building WASM..."
sep
node scripts/build-wasm.mjs

sep
echo "==> Setup complete."
sep

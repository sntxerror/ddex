#!/usr/bin/env bash
set -euo pipefail

# Resolve pnpm from nvm/corepack paths regardless of login shell
export NVM_DIR="/usr/local/share/nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use
export PATH="$HOME/.local/share/pnpm:$NVM_DIR/versions/node/$(ls "$NVM_DIR/versions/node" 2>/dev/null | sort -V | tail -1)/bin:/usr/local/share/nvm/versions/node/$(ls /usr/local/share/nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$PATH"

[ -f .env ] || cp .env.example .env

if pgrep -f 'node ./scripts/run-dev.mjs' >/dev/null 2>&1; then
  echo "[start] dev services already running, skipping."
  exit 0
fi

echo "[start] launching dev services → /tmp/ddex-dev.log"
nohup node scripts/run-dev.mjs --skip-wasm > /tmp/ddex-dev.log 2>&1 &
echo "[start] PID $!"

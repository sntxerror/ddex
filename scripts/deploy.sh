#!/usr/bin/env bash
# deploy.sh — Deploy DDEX frontend + Envoy proxy to production server.
# Called by CI or manually:  ssh ubuntu@host 'bash -s' < scripts/deploy.sh
#
# Expects the following on the server:
#   /opt/ddex/frontend/   — static PWA files (uploaded by CI)
#   /opt/ddex/proxy/      — Envoy proxy (docker-compose + config)
#
set -euo pipefail

DEPLOY_DIR="/opt/ddex"
FRONTEND_DIR="$DEPLOY_DIR/frontend"
PROXY_DIR="$DEPLOY_DIR/proxy"
WEB_ROOT="/var/www/privatesecure.org"

echo "=== DDEX Deploy ==="

# --- 1. Swap frontend into nginx web root ---
if [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/index.html" ]; then
  echo "Deploying frontend to $WEB_ROOT ..."
  sudo rm -rf "${WEB_ROOT:?}/"*
  sudo cp -a "$FRONTEND_DIR/." "$WEB_ROOT/"
  sudo chown -R www-data:www-data "$WEB_ROOT"
  echo "Frontend deployed."
else
  echo "WARNING: $FRONTEND_DIR/index.html not found, skipping frontend deploy."
fi

# --- 2. Start/restart Envoy proxy ---
if [ -f "$PROXY_DIR/docker-compose.prod.yml" ]; then
  echo "Starting Envoy proxy ..."
  cd "$PROXY_DIR"
  docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
  echo "Envoy proxy running."
else
  echo "WARNING: $PROXY_DIR/docker-compose.prod.yml not found, skipping proxy."
fi

# --- 3. Reload nginx ---
echo "Reloading nginx ..."
sudo nginx -t && sudo systemctl reload nginx
echo "Nginx reloaded."

echo "=== Deploy complete ==="

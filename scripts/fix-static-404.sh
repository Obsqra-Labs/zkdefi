#!/usr/bin/env bash
# Fix 404 on /_next/static/* (CSS/JS) on zkde.fi.
# Run this ON THE SERVER that hosts zkde.fi (where Node and nginx run).
#
# Cause: HTML was from an old build (cached) but chunk filenames are from a new build.
# This script: rebuilds frontend, restarts Node, reloads nginx. Then you must purge
# any CDN cache (e.g. Cloudflare "Purge Everything") and hard-refresh the browser.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"

echo "=== Fix zkde.fi static 404 (rebuild + restart + nginx) ==="
cd "$REPO_ROOT"

# 1. Stop frontend so we can rebuild
echo "[1/4] Stopping frontend..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 stop zkdefi-frontend 2>/dev/null || true
fi
for pid in $(ss -tlnp 2>/dev/null | grep ':3001' | grep -oP 'pid=\K[0-9]+' 2>/dev/null || true); do
  kill -9 "$pid" 2>/dev/null || true
done
command -v fuser >/dev/null 2>&1 && fuser -k -9 3001/tcp 2>/dev/null || true
sleep 2

# 2. Rebuild (same env as deploy_production.sh)
echo "[2/4] Rebuilding frontend..."
cd "$FRONTEND_DIR"
rm -rf .next
export NEXT_PUBLIC_API_URL=https://zkde.fi
export NEXT_PUBLIC_EKUBO_HUB_V2=true
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW=true
export NEXT_PUBLIC_MM_SIM_API=https://zkde.fi/sim
export NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=0x07fed6973cfc23b031c0476885ec87a401f1006bdc8ba58df2bd8611b38b5ff5
export NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS=0x02f3a1caf8898e7a17aef89523c74ceafab3262c06f512a81d06c264e0bd25a1
npm run build
cd "$REPO_ROOT"

# 3. Start frontend
echo "[3/4] Starting frontend..."
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe zkdefi-frontend >/dev/null 2>&1; then
    pm2 restart zkdefi-frontend --update-env
  else
    pm2 start ecosystem.config.cjs --only zkdefi-frontend
  fi
  pm2 save 2>/dev/null || true
else
  (cd "$FRONTEND_DIR" && nohup npm start -- -H 0.0.0.0 -p 3001 >> /tmp/zkdefi-frontend.log 2>&1 &)
fi
sleep 4

# 4. Reload nginx (drop any proxy cache)
echo "[4/4] Reloading nginx..."
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t 2>/dev/null && sudo nginx -s reload 2>/dev/null || true
fi

# Quick check
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ | grep -q 200; then
  echo ""
  echo "Done. Local frontend responds 200."
else
  echo "WARNING: http://127.0.0.1:3001/ did not return 200. Check pm2 logs."
fi

echo ""
echo "Next steps:"
echo "  1. If you use Cloudflare (or any CDN): purge cache for zkde.fi (Purge Everything)."
echo "  2. In the browser: hard refresh (Ctrl+Shift+R or Cmd+Shift+R) or open in incognito."
echo ""

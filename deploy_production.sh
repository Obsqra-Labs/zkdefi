#!/bin/bash
# Deploy zkde.fi frontend to production on this VPS.
# Builds with NEXT_PUBLIC_API_URL=https://zkde.fi, then restarts the frontend.
# Nginx routes zkde.fi → :3001 and /api/v1/zkdefi → :8003.
#
# Run this on the server that hosts zkde.fi after code changes. A full build + start
# ensures HTML and _next/static chunks are from the same build (avoids ChunkLoadError
# and missing CSS). If you use nginx cache, clear it after deploy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
LIVE_ORIGIN="${LIVE_ORIGIN:-https://zkde.fi}"

extract_agent_chunks() {
  local origin="$1"
  curl -fsS "${origin}/agent" \
    | grep -oE '/_next/static/chunks[^"[:space:]]+\.js' \
    | sed 's#^/##' \
    | sort -u
}

extract_agent_css() {
  local origin="$1"
  curl -fsS "${origin}/agent" \
    | grep -oE '/_next/static/css[^"[:space:]]+\.css' \
    | sed 's#^/##' \
    | sort -u
}

verify_assets() {
  local origin="$1"
  local label="$2"
  local missing=0
  local chunks
  local css_assets
  chunks="$(extract_agent_chunks "$origin" || true)"
  css_assets="$(extract_agent_css "$origin" || true)"
  if [ -z "$chunks" ]; then
    echo "ERROR: ${label} did not return any agent chunks"
    return 1
  fi
  if [ -z "$css_assets" ]; then
    echo "ERROR: ${label} did not return any agent CSS assets"
    return 1
  fi
  while read -r chunk; do
    [ -z "$chunk" ] && continue
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' "${origin}/${chunk}")"
    if [ "$code" != "200" ]; then
      echo "ERROR: ${label} missing chunk ${chunk} (HTTP ${code})"
      missing=1
    fi
  done <<< "$chunks"
  while read -r css_asset; do
    [ -z "$css_asset" ] && continue
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' "${origin}/${css_asset}")"
    if [ "$code" != "200" ]; then
      echo "ERROR: ${label} missing CSS ${css_asset} (HTTP ${code})"
      missing=1
    fi
  done <<< "$css_assets"
  if [ "$missing" -ne 0 ]; then
    return 1
  fi
  return 0
}

echo "Deploying zkde.fi frontend (production build)"
echo "=============================================="

# 1. Stop existing frontend on 3001
echo "Stopping existing frontend..."
# Stop PM2-managed zkdefi frontend if present (targeted)
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe zkdefi-frontend >/dev/null 2>&1; then
    pm2 stop zkdefi-frontend >/dev/null 2>&1 || true
  fi
fi
# Find ALL PIDs on port 3001 and kill them
PORT_PIDS="$({ ss -tlnp 2>/dev/null | grep ':3001' | grep -oP 'pid=\K[0-9]+' | sort -u; } || true)"
if [ -n "$PORT_PIDS" ]; then
  echo "$PORT_PIDS" | while read -r pid; do
    kill -9 "$pid" 2>/dev/null || true
  done
fi
# Also kill any process on port 3001 using fuser (fallback)
if command -v fuser >/dev/null 2>&1; then
  fuser -k -9 3001/tcp 2>/dev/null || true
fi
sleep 3
# Verify port is free
if ss -tlnp 2>/dev/null | grep -q ':3001'; then
  echo "ERROR: Port 3001 still in use after cleanup!"
  ss -tlnp | grep ':3001'
  exit 1
fi

# 2. Build with production env (NEXT_PUBLIC_* baked in at build time)
echo "Building frontend (production env)..."
cd "$FRONTEND_DIR"
# Ensure there are no stale build artifacts between deploys
rm -rf .next
# Base origin only: frontend appends /api/v1/zkdefi/... so final URL is https://zkde.fi/api/v1/zkdefi/...
export NEXT_PUBLIC_API_URL=https://zkde.fi
export NEXT_PUBLIC_EKUBO_HUB_V2=true
# Full Privacy Pool: use deposit(felt252) so Confirm Deposit works (avoids ENTRYPOINT_NOT_FOUND on current pool)
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW=true
# Market-maker simulator API (same origin, proxied by nginx)
export NEXT_PUBLIC_MM_SIM_API=https://zkde.fi/sim
# Production pool (Sepolia)
export NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=0x07fed6973cfc23b031c0476885ec87a401f1006bdc8ba58df2bd8611b38b5ff5
# V2 Pool with partial withdraw support (Sepolia)
export NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS=0x02f3a1caf8898e7a17aef89523c74ceafab3262c06f512a81d06c264e0bd25a1
# Token for pool (default Sepolia STRK/ETH; override if different)
# export NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
npm run build

EXPECTED_AGENT_CHUNK="$(ls .next/static/chunks/app/agent/page-*.js 2>/dev/null | head -n1 | xargs -r basename || true)"
if [ -z "$EXPECTED_AGENT_CHUNK" ]; then
  echo "ERROR: Could not find built agent page chunk in .next/static/chunks/app/agent"
  exit 1
fi
echo "Built agent chunk: $EXPECTED_AGENT_CHUNK"

# 3. Start production server
echo "Starting production server on port 3001..."
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe zkdefi-frontend >/dev/null 2>&1; then
    pm2 restart zkdefi-frontend --update-env >/dev/null 2>&1
  else
    pm2 start npm --name zkdefi-frontend --cwd "$FRONTEND_DIR" -- start -- -H 0.0.0.0 -p 3001 >/dev/null 2>&1
  fi
  pm2 save >/dev/null 2>&1 || true
else
  nohup npm start -- -H 0.0.0.0 -p 3001 >> /tmp/zkdefi-frontend.log 2>&1 &
fi
sleep 5

if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ | grep -q 200; then
  echo ""
  echo "Frontend is up at http://127.0.0.1:3001 (nginx serves https://zkde.fi)."
  echo "Logs: tail -f /tmp/zkdefi-frontend.log"
else
  echo "WARNING: Frontend may not have started. Check /tmp/zkdefi-frontend.log"
  exit 1
fi

echo "Running local chunk integrity checks..."
verify_assets "http://127.0.0.1:3001" "local"

echo "Running live chunk integrity checks (${LIVE_ORIGIN})..."
verify_assets "$LIVE_ORIGIN" "live"

LIVE_AGENT_CHUNK="$(curl -fsS "${LIVE_ORIGIN}/agent" | grep -oE '_next/static/chunks/app/agent/page-[^"[:space:]]+\.js' | head -n1 | xargs -r basename || true)"
if [ -z "$LIVE_AGENT_CHUNK" ]; then
  echo "ERROR: Could not parse live agent chunk from ${LIVE_ORIGIN}/agent"
  exit 1
fi

if [ "$LIVE_AGENT_CHUNK" != "$EXPECTED_AGENT_CHUNK" ]; then
  echo "ERROR: Live agent chunk mismatch"
  echo "  built: $EXPECTED_AGENT_CHUNK"
  echo "  live:  $LIVE_AGENT_CHUNK"
  echo "This indicates stale runtime/cache drift. Retry deploy and clear edge cache if enabled."
  exit 1
fi

echo "Chunk integrity check passed: live matches built chunk (${EXPECTED_AGENT_CHUNK})"

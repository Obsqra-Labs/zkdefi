#!/bin/bash
# Deploy zkde.fi frontend to production on this VPS.
# Builds with NEXT_PUBLIC_API_URL=https://zkde.fi, then restarts the frontend.
# Nginx routes zkde.fi → :3001 and /api/v1/zkdefi → :8003.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo "Deploying zkde.fi frontend (production build)"
echo "=============================================="

# 1. Stop existing frontend on 3001
if pgrep -f 'next-server.*3001' > /dev/null; then
  echo "Stopping existing frontend..."
  pkill -f 'next-server.*3001' 2>/dev/null || true
  sleep 2
fi
# Ensure port is free
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3001/tcp 2>/dev/null || true
  sleep 2
fi

# 2. Build with production env (NEXT_PUBLIC_* baked in at build time)
echo "Building frontend (production env)..."
cd "$FRONTEND_DIR"
# Base origin only: frontend appends /api/v1/zkdefi/... so final URL is https://zkde.fi/api/v1/zkdefi/...
export NEXT_PUBLIC_API_URL=https://zkde.fi
# Full Privacy Pool: use deposit(felt252) so Confirm Deposit works (avoids ENTRYPOINT_NOT_FOUND on current pool)
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW=true
# Production pool (Sepolia)
export NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=0x0700376443e295f33dda9ac2721a95d601f6b7c38719d58077049de357d3b85f
# Token for pool (default Sepolia STRK/ETH; override if different)
# export NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
npm run build

# 3. Start production server
echo "Starting production server on port 3001..."
nohup npm start >> /tmp/zkdefi-frontend.log 2>&1 &
sleep 3

if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ | grep -q 200; then
  echo ""
  echo "Frontend is up at http://127.0.0.1:3001 (nginx serves https://zkde.fi)."
  echo "Logs: tail -f /tmp/zkdefi-frontend.log"
else
  echo "WARNING: Frontend may not have started. Check /tmp/zkdefi-frontend.log"
  exit 1
fi

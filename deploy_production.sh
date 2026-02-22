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
echo "Stopping existing frontend..."
# Kill ALL next-server processes (not just on 3001)
pkill -9 -f 'next-server' 2>/dev/null || true
# Kill parent npm/node processes that spawn them
pkill -9 -f 'npm.*start.*3001' 2>/dev/null || true
pkill -9 -f 'node.*next.*start' 2>/dev/null || true
# Find ALL PIDs on port 3001 and kill them
PORT_PIDS=$(ss -tlnp 2>/dev/null | grep ':3001' | grep -oP 'pid=\K[0-9]+' | sort -u)
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
# Base origin only: frontend appends /api/v1/zkdefi/... so final URL is https://zkde.fi/api/v1/zkdefi/...
export NEXT_PUBLIC_API_URL=https://zkde.fi
# Full Privacy Pool: use deposit(felt252) so Confirm Deposit works (avoids ENTRYPOINT_NOT_FOUND on current pool)
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true
export NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW=true
# Production pool (Sepolia)
export NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=0x07fed6973cfc23b031c0476885ec87a401f1006bdc8ba58df2bd8611b38b5ff5
# V2 Pool with partial withdraw support (Sepolia)
export NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS=0x02f3a1caf8898e7a17aef89523c74ceafab3262c06f512a81d06c264e0bd25a1
# Token for pool (default Sepolia STRK/ETH; override if different)
# export NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
npm run build

# 3. Start production server
echo "Starting production server on port 3001..."
nohup npm start -- -H 0.0.0.0 -p 3001 >> /tmp/zkdefi-frontend.log 2>&1 &
sleep 5

if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ | grep -q 200; then
  echo ""
  echo "Frontend is up at http://127.0.0.1:3001 (nginx serves https://zkde.fi)."
  echo "Logs: tail -f /tmp/zkdefi-frontend.log"
else
  echo "WARNING: Frontend may not have started. Check /tmp/zkdefi-frontend.log"
  exit 1
fi

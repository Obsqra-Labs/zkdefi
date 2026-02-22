#!/usr/bin/env bash
# Restart zkdefi backend and relayer-runner from ecosystem.config.cjs.
# Run from zkdefi: ./scripts/pm2_restart_zkdefi.sh
set -euo pipefail
cd "$(dirname "$0")/.."
pm2 delete zkdefi-backend zkdefi-relayer-runner 2>/dev/null || true
pm2 start ecosystem.config.cjs --only zkdefi-backend --only zkdefi-relayer-runner
pm2 save
echo "Done. Check: pm2 list && pm2 logs zkdefi-backend --lines 5 && pm2 logs zkdefi-relayer-runner --lines 5"

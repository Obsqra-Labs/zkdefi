#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/zkdefi/backend"

if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_DIR/.env"
  set +a
fi

OWNER_INFO="$ROOT_DIR/OWNER_WALLET_INFO.md"
if [ ! -f "$OWNER_INFO" ]; then
  FALLBACK_OWNER_INFO="/opt/obsqra.starknet/OWNER_WALLET_INFO.md"
  if [ -f "$FALLBACK_OWNER_INFO" ]; then
    OWNER_INFO="$FALLBACK_OWNER_INFO"
  else
    echo "OWNER_WALLET_INFO.md not found at $OWNER_INFO or $FALLBACK_OWNER_INFO" >&2
    exit 1
  fi
fi

read -r RELAYER_ADDRESS RELAYER_PRIVATE_KEY < <(
  python3 - "$OWNER_INFO" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
addr = None
pk = None
for line in text.splitlines():
    if "Address" in line and "0x" in line:
        m = re.search(r"0x[0-9a-fA-F]{6,}", line)
        if m:
            addr = m.group(0)
    if "Private" in line and "0x" in line:
        m = re.search(r"0x[0-9a-fA-F]{6,}", line)
        if m:
            pk = m.group(0)
if not addr or not pk:
    raise SystemExit("Could not parse owner wallet info")
print(addr, pk)
PY
)

export RELAYER_RUNNER_ENABLED="true"
export RELAYER_DRY_RUN="${RELAYER_DRY_RUN:-false}"
export RELAYER_WAIT_FOR_TX="${RELAYER_WAIT_FOR_TX:-true}"
export RELAYER_MAX_BATCH="${RELAYER_MAX_BATCH:-1}"
export RELAYER_POLL_SECONDS="${RELAYER_POLL_SECONDS:-10}"
export RELAYER_CHAIN_ID="${RELAYER_CHAIN_ID:-sepolia}"
export RELAYER_RPC_URL="${RELAYER_RPC_URL:-https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/EvhYN6geLrdvbYHVRgPJ7}"
export RELAYER_RUNNER_USE_CLI="${RELAYER_RUNNER_USE_CLI:-true}"
if [ -z "${RELAYER_STARKLI_ACCOUNT:-}" ] && [ -f "/root/.starkli/accounts/deployer_starkli.json" ]; then
  export RELAYER_STARKLI_ACCOUNT="/root/.starkli/accounts/deployer_starkli.json"
fi
export RELAYER_ADDRESS
export RELAYER_PRIVATE_KEY

exec /opt/obsqra.starknet/zkdefi/.venv_py311/bin/python3 "$BACKEND_DIR/relayer_runner.py"

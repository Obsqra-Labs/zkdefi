#!/usr/bin/env bash
# Wire a real Starknet mainnet executor into backend/.env and restart the backend.
# This keeps live execution disabled by default. It is meant to be run locally on the VPS
# after the operator has recovered/imported the wallet outside of chat.
#
# Usage:
#   ./scripts/configure_mainnet_executor.sh \
#     --account-path /root/.starkli-wallets/mainnet/account.json \
#     --private-key-file /root/.starkli-wallets/mainnet/private_key.txt \
#     --expect-address 0x0348914Bed4FDC65399d347C4498D778B75d5835D9276027a4357FE78B4a7eb3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/backend/.env"
RPC_URL="${RPC_URL:-https://rpc.starknet.lava.build:443}"
ACCOUNT_PATH=""
PRIVATE_KEY_FILE=""
EXPECT_ADDRESS=""
LIVE_SUBMIT="${LIVE_SUBMIT:-false}"
GATE_LIVE="${GATE_LIVE:-false}"
RESTART_PM2="${RESTART_PM2:-true}"

usage() {
  cat <<'EOF'
Usage:
  configure_mainnet_executor.sh --account-path PATH --private-key-file PATH [options]

Required:
  --account-path PATH         Starkli account JSON path for the mainnet signer
  --private-key-file PATH     File containing the raw Starknet private key hex

Optional:
  --expect-address ADDRESS    Fail if the account JSON address does not match
  --rpc-url URL               Mainnet RPC URL (default: https://rpc.starknet.lava.build:443)
  --live-submit true|false    Set EXECUTOR_LIVE_SUBMIT_MAINNET (default: false)
  --gate-live true|false      Set EXECUTION_GATE_ALLOW_MAINNET_LIVE (default: false)
  --restart-pm2 true|false    Restart zkdefi-backend after writing env (default: true)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --account-path)
      ACCOUNT_PATH="${2:-}"
      shift 2
      ;;
    --private-key-file)
      PRIVATE_KEY_FILE="${2:-}"
      shift 2
      ;;
    --expect-address)
      EXPECT_ADDRESS="${2:-}"
      shift 2
      ;;
    --rpc-url)
      RPC_URL="${2:-}"
      shift 2
      ;;
    --live-submit)
      LIVE_SUBMIT="${2:-false}"
      shift 2
      ;;
    --gate-live)
      GATE_LIVE="${2:-false}"
      shift 2
      ;;
    --restart-pm2)
      RESTART_PM2="${2:-true}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$ACCOUNT_PATH" ] || [ -z "$PRIVATE_KEY_FILE" ]; then
  usage
  exit 1
fi

if [ ! -f "$ACCOUNT_PATH" ]; then
  echo "Missing account file: $ACCOUNT_PATH" >&2
  exit 1
fi
if [ ! -f "$PRIVATE_KEY_FILE" ]; then
  echo "Missing private key file: $PRIVATE_KEY_FILE" >&2
  exit 1
fi

ACCOUNT_ADDRESS="$(python3 - <<'PY' "$ACCOUNT_PATH"
import json, sys
payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
deployment = payload.get("deployment") if isinstance(payload, dict) else None
address = ""
if isinstance(deployment, dict):
    address = str(deployment.get("address") or "").strip()
if not address and isinstance(payload, dict):
    address = str(payload.get("address") or "").strip()
print(address)
PY
)"

if [ -z "$ACCOUNT_ADDRESS" ]; then
  echo "Could not read account address from $ACCOUNT_PATH" >&2
  exit 1
fi

if [ -n "$EXPECT_ADDRESS" ]; then
  if [ "${ACCOUNT_ADDRESS,,}" != "${EXPECT_ADDRESS,,}" ]; then
    echo "Account address mismatch:" >&2
    echo "  expected: $EXPECT_ADDRESS" >&2
    echo "  found:    $ACCOUNT_ADDRESS" >&2
    exit 1
  fi
fi

PRIVATE_KEY="$(tr -d '\r\n' < "$PRIVATE_KEY_FILE")"
if [ -z "$PRIVATE_KEY" ]; then
  echo "Private key file is empty: $PRIVATE_KEY_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

python3 - <<'PY' "$ENV_FILE" "$RPC_URL" "$ACCOUNT_PATH" "$PRIVATE_KEY" "$LIVE_SUBMIT" "$GATE_LIVE"
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
updates = {
    "EXECUTOR_RPC_URL_MAINNET": sys.argv[2],
    "EXECUTOR_ACCOUNT_PATH_MAINNET": sys.argv[3],
    "EXECUTOR_PRIVATE_KEY_MAINNET": sys.argv[4],
    "EXECUTOR_LIVE_SUBMIT_MAINNET": sys.argv[5].lower(),
    "EXECUTION_GATE_ALLOW_MAINNET_LIVE": sys.argv[6].lower(),
}

lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
seen = set()
out = []
for line in lines:
    if "=" not in line or line.lstrip().startswith("#"):
        out.append(line)
        continue
    key = line.split("=", 1)[0].strip()
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)

for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")

env_path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY

echo "Wrote mainnet executor config to ${ENV_FILE}"
echo "  account: ${ACCOUNT_ADDRESS}"
echo "  rpc:     ${RPC_URL}"
echo "  live:    ${LIVE_SUBMIT}"
echo "  gate:    ${GATE_LIVE}"

if [ "${RESTART_PM2}" = "true" ]; then
  pm2 restart zkdefi-backend --update-env
  sleep 3
fi

curl -fsS http://127.0.0.1:8003/api/v1/execution_gate/readiness/starknet_mainnet || {
  echo "Backend readiness check failed after config write." >&2
  exit 1
}


#!/usr/bin/env bash
# Smoke-check the mainnet portfolio lane locally or through the live domain.
# Usage:
#   ./scripts/smoke_portfolio_mainnet.sh
#   BASE_URL=https://zkde.fi ./scripts/smoke_portfolio_mainnet.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
API_BASE="${API_BASE:-http://127.0.0.1:8003}"
OWNER_ADDRESS="${OWNER_ADDRESS:-0x0123456789abcdef}"

check_code() {
  local url="$1"
  local expected="${2:-200}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url")"
  if [ "$code" != "$expected" ]; then
    echo "ERROR: ${url} -> HTTP ${code}, expected ${expected}"
    exit 1
  fi
  echo "OK    ${url} -> ${code}"
}

check_json_field() {
  local url="$1"
  local field="$2"
  local expected="$3"
  local normalize="${4:-false}"
  local value
  value="$(curl -fsS "$url" | python3 -c "import json,sys; print(json.load(sys.stdin).get('${field}', ''))")"
  if [ "$normalize" = "true" ]; then
    value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
  fi
  if [ "$value" != "$expected" ]; then
    echo "ERROR: ${url} field ${field} -> ${value} (expected ${expected})"
    exit 1
  fi
  echo "OK    ${url} field ${field} -> ${value}"
}

echo "=== Portfolio mainnet smoke ==="
echo "Frontend base: ${BASE_URL}"
echo "API base:      ${API_BASE}"

check_code "${BASE_URL}/portfolio" 200
check_code "${API_BASE}/health" 200
check_json_field "${API_BASE}/api/v1/execution_gate/readiness/starknet_mainnet" "network_id" "starknet_mainnet"
check_json_field "${API_BASE}/api/v1/execution_gate/telemetry/${OWNER_ADDRESS}" "owner_address" "${OWNER_ADDRESS}" "true"

echo "Checking gate policy endpoint..."
POLICY_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}/api/v1/execution_gate/policy/${OWNER_ADDRESS}")"
if [ "$POLICY_CODE" != "200" ] && [ "$POLICY_CODE" != "500" ]; then
  echo "ERROR: unexpected policy response ${POLICY_CODE}"
  exit 1
fi
echo "OK    ${API_BASE}/api/v1/execution_gate/policy/${OWNER_ADDRESS} -> ${POLICY_CODE}"

echo "Portfolio smoke passed."

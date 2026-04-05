#!/usr/bin/env bash
# Smoke-check the mainnet portfolio lane locally or through the live domain.
# Usage:
#   ./scripts/smoke_portfolio_mainnet.sh
#   BASE_URL=https://zkde.fi ./scripts/smoke_portfolio_mainnet.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
API_BASE="${API_BASE:-http://127.0.0.1:8003}"
OWNER_ADDRESS="${OWNER_ADDRESS:-0x0123456789abcdef}"
AUTH_CHAIN_ID="${AUTH_CHAIN_ID:-0x534e5f4d41494e}"
AUTH_SMOKE_ADDRESS="${AUTH_SMOKE_ADDRESS:-0x0123456789abcdef}"

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

check_json_number_at_least() {
  local url="$1"
  local field="$2"
  local min_value="$3"
  local value
  value="$(curl -fsS "$url" | python3 -c "import json,sys; print(json.load(sys.stdin).get('${field}', -1))")"
  if [ "$value" -lt "$min_value" ]; then
    echo "ERROR: ${url} field ${field} -> ${value} (expected >= ${min_value})"
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
TELEMETRY_PATH="${API_BASE}/api/v1/execution_gate/telemetry/${OWNER_ADDRESS}"
TELEMETRY_CODE="$(curl -s -o /tmp/portfolio_telemetry_smoke.json -w '%{http_code}' "${TELEMETRY_PATH}")"
if [ "${TELEMETRY_CODE}" = "200" ]; then
  TELEMETRY_OWNER="$(python3 -c "import json; print(json.load(open('/tmp/portfolio_telemetry_smoke.json','r')).get('owner_address',''))")"
  TELEMETRY_OWNER_LC="$(printf '%s' "${TELEMETRY_OWNER}" | tr '[:upper:]' '[:lower:]')"
  OWNER_LC="$(printf '%s' "${OWNER_ADDRESS}" | tr '[:upper:]' '[:lower:]')"
  if [ "${TELEMETRY_OWNER_LC}" != "${OWNER_LC}" ]; then
    echo "ERROR: ${TELEMETRY_PATH} owner_address mismatch (${TELEMETRY_OWNER} != ${OWNER_ADDRESS})"
    rm -f /tmp/portfolio_telemetry_smoke.json
    exit 1
  fi
  echo "OK    ${TELEMETRY_PATH} -> 200 (owner_address matches)"
elif [ "${TELEMETRY_CODE}" = "401" ]; then
  echo "OK    ${TELEMETRY_PATH} -> 401 (endpoint is auth-gated, expected in hardened deploys)"
else
  echo "ERROR: ${TELEMETRY_PATH} -> HTTP ${TELEMETRY_CODE} (expected 200 or 401)"
  rm -f /tmp/portfolio_telemetry_smoke.json
  exit 1
fi
rm -f /tmp/portfolio_telemetry_smoke.json

echo "Checking portfolio auth start/complete smoke..."
AUTH_START_PAYLOAD="$(printf '{"starknet_address":"%s","chain_id":"%s"}' "${AUTH_SMOKE_ADDRESS}" "${AUTH_CHAIN_ID}")"
AUTH_START_BODY_FILE="$(mktemp)"
AUTH_START_CODE="$(curl -sS -o "${AUTH_START_BODY_FILE}" -w '%{http_code}' \
  -X POST "${API_BASE}/api/v1/portfolio/auth/session/start" \
  -H 'content-type: application/json' \
  -d "${AUTH_START_PAYLOAD}")"
if [ "${AUTH_START_CODE}" != "200" ]; then
  echo "ERROR: /api/v1/portfolio/auth/session/start -> HTTP ${AUTH_START_CODE}"
  cat "${AUTH_START_BODY_FILE}"
  rm -f "${AUTH_START_BODY_FILE}"
  exit 1
fi
AUTH_NONCE_ID="$(python3 -c "import json,sys; print(json.load(open('${AUTH_START_BODY_FILE}', 'r')).get('nonce_id',''))")"
rm -f "${AUTH_START_BODY_FILE}"
if [ -z "${AUTH_NONCE_ID}" ]; then
  echo "ERROR: /api/v1/portfolio/auth/session/start did not return nonce_id"
  exit 1
fi
echo "OK    /api/v1/portfolio/auth/session/start -> 200 (nonce_id present)"

# With dummy signature, complete should fail with 401 (unauthorized) rather than 404/500.
AUTH_COMPLETE_PAYLOAD="$(printf '{"starknet_address":"%s","nonce_id":"%s","signature":["0x1","0x2"]}' "${AUTH_SMOKE_ADDRESS}" "${AUTH_NONCE_ID}")"
AUTH_COMPLETE_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "${API_BASE}/api/v1/portfolio/auth/session/complete" \
  -H 'content-type: application/json' \
  -d "${AUTH_COMPLETE_PAYLOAD}")"
if [ "${AUTH_COMPLETE_CODE}" != "401" ]; then
  echo "ERROR: /api/v1/portfolio/auth/session/complete -> HTTP ${AUTH_COMPLETE_CODE}, expected 401 with dummy signature"
  exit 1
fi
echo "OK    /api/v1/portfolio/auth/session/complete -> 401 with dummy signature"

check_code "${API_BASE}/api/v1/portfolio/auth/telemetry/summary?window_sec=3600" 200
check_json_number_at_least "${API_BASE}/api/v1/portfolio/auth/telemetry/summary?window_sec=3600" "window_sec" 60

echo "Checking gate policy endpoint..."
POLICY_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}/api/v1/execution_gate/policy/${OWNER_ADDRESS}")"
if [ "$POLICY_CODE" != "200" ] && [ "$POLICY_CODE" != "500" ] && [ "$POLICY_CODE" != "401" ]; then
  echo "ERROR: unexpected policy response ${POLICY_CODE}"
  exit 1
fi
echo "OK    ${API_BASE}/api/v1/execution_gate/policy/${OWNER_ADDRESS} -> ${POLICY_CODE}"

echo "Portfolio smoke passed."

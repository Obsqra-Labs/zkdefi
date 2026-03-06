#!/usr/bin/env bash
# Import the zkDeFi Reputation dashboard into Grafana via HTTP API.
# Requires: GRAFANA_URL (e.g. http://localhost:3001) and one of:
#   GRAFANA_API_KEY (service account or API key), or
#   GRAFANA_USER and GRAFANA_PASSWORD (basic auth).
# Usage: GRAFANA_URL=http://localhost:3001 GRAFANA_API_KEY=... ./scripts/import_grafana_dashboard.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASH="$ROOT/monitoring/grafana_reputation_dashboard.json"

if [[ -z "${GRAFANA_URL}" ]]; then
  echo "Set GRAFANA_URL (e.g. http://localhost:3001)"
  exit 1
fi

if [[ -n "${GRAFANA_API_KEY}" ]]; then
  AUTH_FLAG=(-H "Authorization: Bearer ${GRAFANA_API_KEY}")
elif [[ -n "${GRAFANA_USER}" && -n "${GRAFANA_PASSWORD}" ]]; then
  AUTH_FLAG=(-u "${GRAFANA_USER}:${GRAFANA_PASSWORD}")
else
  echo "Set GRAFANA_API_KEY or GRAFANA_USER and GRAFANA_PASSWORD"
  exit 1
fi

payload=$(jq -c -n --slurpfile d "$DASH" '{ dashboard: $d[0], overwrite: true }')
url="${GRAFANA_URL%/}/api/dashboards/db"

curl -s -X POST "$url" \
  -H "Content-Type: application/json" \
  "${AUTH_FLAG[@]}" \
  -d "$payload" | jq .

echo "Dashboard import requested. Check Grafana at ${GRAFANA_URL}/d/zkdefi-reputation-proofs"

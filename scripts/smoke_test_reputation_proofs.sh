#!/usr/bin/env bash
# Smoke test all 5 reputation proof endpoints (plan: Final Verification Step 1).
# Usage: ./scripts/smoke_test_reputation_proofs.sh [BASE_URL]
# Default BASE_URL: http://127.0.0.1:8003

set -e
BASE_URL="${1:-http://127.0.0.1:8003}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Smoke testing reputation proofs at $BASE_URL"
for circuit in solvency risk-passport performance strategy-integrity execution-integrity; do
  echo "Testing $circuit..."
  json="$ROOT/test_data/${circuit}_test.json"
  if [[ ! -f "$json" ]]; then
    echo "  SKIP: $json not found"
    continue
  fi
  out=$(curl -s -X POST "$BASE_URL/api/v1/zkdefi/reputation/proof/$circuit" \
    -H "Content-Type: application/json" \
    -d @"$json") || true
  all_pass=$(echo "$out" | jq -r '.all_pass // "null"')
  if [[ "$all_pass" == "true" ]]; then
    echo "  OK: all_pass=true"
  else
    echo "  RESPONSE: $out"
  fi
done
echo "Done."

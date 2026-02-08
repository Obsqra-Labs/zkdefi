#!/usr/bin/env bash
# Backend Full Privacy path e2e: health, generate_commitment, register_commitment.
# Usage: BACKEND_URL=http://localhost:8003 ./tests/backend_full_privacy_e2e.sh

set -e
BASE="${BACKEND_URL:-http://localhost:8003}"

echo "=== 1. Health ==="
code=$(curl -s -o /tmp/health.json -w "%{http_code}" "$BASE/health")
if [ "$code" != "200" ]; then echo "FAIL health: $code"; exit 1; fi
echo "OK $code"

echo "=== 2. Full Privacy: generate_commitment ==="
code=$(curl -s -o /tmp/gen.json -w "%{http_code}" -X POST "$BASE/api/v1/zkdefi/full_privacy/deposit/generate_commitment" \
  -H "Content-Type: application/json" \
  -d '{"user_address":"0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d","amount":"1000000000000000000","pool_type":0}')
if [ "$code" != "200" ]; then echo "FAIL generate_commitment: $code"; cat /tmp/gen.json; exit 1; fi
commitment=$(python3 -c "import json; print(json.load(open('/tmp/gen.json')).get('commitment',''))")
if [ -z "$commitment" ]; then echo "FAIL no commitment"; exit 1; fi
echo "OK commitment=${commitment:0:30}..."

echo "=== 3. Full Privacy: register_commitment ==="
code=$(curl -s -o /tmp/reg.json -w "%{http_code}" -X POST "$BASE/api/v1/zkdefi/full_privacy/deposit/register_commitment" \
  -H "Content-Type: application/json" \
  -d "{\"commitment\":\"$commitment\"}")
if [ "$code" != "200" ]; then echo "FAIL register_commitment: $code"; cat /tmp/reg.json; exit 1; fi
root=$(python3 -c "import json; print(json.load(open('/tmp/reg.json')).get('merkle_root',''))")
if [ -z "$root" ]; then echo "FAIL no merkle_root"; exit 1; fi
echo "OK merkle_root=${root:0:30}..."

echo "=== All Full Privacy paths OK ==="

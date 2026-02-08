#!/usr/bin/env bash
set -e
BASE="${BACKEND_URL:-http://localhost:8003}"
curl -sf "$BASE/health" > /dev/null && echo "health OK" || exit 1
curl -sf -X POST "$BASE/api/v1/zkdefi/full_privacy/deposit/generate_commitment" -H "Content-Type: application/json" -d '{"user_address":"0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d","amount":"1000000000000000000","pool_type":0}' -o /tmp/gen.json && echo "generate_commitment OK" || exit 1
c=$(python3 -c "import json; print(json.load(open('/tmp/gen.json'))['commitment'])")
curl -sf -X POST "$BASE/api/v1/zkdefi/full_privacy/deposit/register_commitment" -H "Content-Type: application/json" -d '{"commitment":"'"$c"'"}' -o /tmp/reg.json && echo "register_commitment OK" || exit 1
python3 -c "import json; assert 'merkle_root' in json.load(open('/tmp/reg.json'))" && echo "merkle_root present OK"
echo "All Full Privacy paths OK"

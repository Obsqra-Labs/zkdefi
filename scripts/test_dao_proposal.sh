#!/bin/bash
# Test DAO proposal creation via API (obsqra.xyz)
set -e

API_BASE="${API_BASE:-http://127.0.0.1:8003}"

echo "=== Test DAO Proposal Creation ==="
echo "API: $API_BASE/api/v1"
echo ""

echo "1. Creating proposal..."
RESP=$(curl -s -X POST "$API_BASE/api/v1/dao/proposals" \
  -H "Content-Type: application/json" \
  -d '{
    "proposer_address": "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
    "proposal_type": "adapter_limit",
    "target_address": "0x02900291a932aa63f6510b9320e13fc25cf2dd7c2274ebe3a671ec6daecd83cd",
    "new_value": 3,
    "vote_duration_seconds": 86400
  }')

echo "$RESP" | jq '.'

PROPOSAL_ID=$(echo "$RESP" | jq -r '.proposal_id // empty')
if [ -n "$PROPOSAL_ID" ] && [ "$PROPOSAL_ID" != "null" ]; then
  echo ""
  echo "2. Proposal created with ID: $PROPOSAL_ID"
  echo "3. Listing proposals..."
  curl -s "$API_BASE/api/v1/dao/proposals?limit=5" | jq '.'
else
  echo "Proposal creation returned no proposal_id (API may use mock)."
  PROPOSAL_ID=1
fi

echo ""
echo "4. Cast vote (non-private fallback)..."
curl -s -X POST "$API_BASE/api/v1/dao/vote/cast" \
  -H "Content-Type: application/json" \
  -d "{
    \"user_address\": \"0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d\",
    \"proposal_id\": ${PROPOSAL_ID:-1},
    \"vote_direction\": 1
  }" | jq '.'

echo ""
echo "=== DAO proposal test complete ==="

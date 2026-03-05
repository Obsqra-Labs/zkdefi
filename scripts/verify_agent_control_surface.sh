#!/usr/bin/env bash
# Deterministic verification: hit /agent and tab routes; assert 200 and app shell.
# Tab labels (Vault, Brain, etc.) are client-rendered; verify in browser at BASE/agent.
# Run from repo root. Requires frontend dev server on port 3001 (npm run dev in frontend/).

set -e
BASE="${1:-http://localhost:3001}"
AGENT="${BASE}/agent"

echo "Verifying agent at ${AGENT}"

# Wait for server
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" "${AGENT}" | grep -q 200; then
    break
  fi
  echo "Waiting for server... ($i/10)"
  sleep 2
done

HTML=$(curl -s -L "${AGENT}" || true)
if [ -z "$HTML" ]; then
  echo "FAIL: No response from ${AGENT}"
  exit 1
fi

# App shell or Next payload (deterministic for SPA)
if echo "$HTML" | grep -qi "zkde.fi"; then
  echo "  OK: app shell (zkde.fi)"
else
  echo "  FAIL: app shell not found"
  exit 1
fi

# Tab deep links must return 200
TABS=( "vault" "ai_pool" "activity" "privacy" "brain" "trust" "system" "developer" "onboarding" )
FAILS=0
for tab in "${TABS[@]}"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "${AGENT}?tab=${tab}" || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "  OK: ?tab=${tab} -> 200"
  else
    echo "  FAIL: ?tab=${tab} -> ${CODE}"
    FAILS=$((FAILS+1))
  fi
done

if [ $FAILS -gt 0 ]; then
  echo "FAIL: $FAILS tab routes failed"
  exit 1
fi
echo "PASS: /agent and all tab routes return 200. Open ${AGENT} in browser to confirm Control Surface UI."

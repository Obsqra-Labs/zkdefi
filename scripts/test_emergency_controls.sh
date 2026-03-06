#!/bin/bash
# Test DAO emergency pause/unpause (obsqra.xyz).
# Requires: starkli, RPC, keystore, and DAO contract address.
set -e

DAO_CONTRACT="${DAO_CONTRACT:-0x0101bd9710017c0870077dcf03bf6fe68a955d9f9b9922ed5d673afed7497fc2}"
RPC="${RPC:-http://127.0.0.1:6060}"
ACCOUNT="${ACCOUNT:-/root/.starkli/accounts/deployer_starkli.json}"
KEYSTORE="${KEYSTORE:-/root/.starkli/keystore.json}"
KEYSTORE_PASSWORD="${KEYSTORE_PASSWORD:-L!nux123}"

echo "=== Emergency controls test ==="
echo "DAO: $DAO_CONTRACT"
echo ""

echo "1. Current pause status..."
starkli call "$DAO_CONTRACT" is_paused --rpc "$RPC" 2>/dev/null || echo "  (call may not exist or RPC down)"

echo ""
echo "2. Pause (requires owner/multisig)..."
starkli invoke "$DAO_CONTRACT" emergency_pause \
  --rpc "$RPC" \
  --account "$ACCOUNT" \
  --keystore "$KEYSTORE" \
  --keystore-password "$KEYSTORE_PASSWORD" 2>&1 || echo "  (invoke may fail if not owner)"

echo ""
echo "3. Verify paused..."
starkli call "$DAO_CONTRACT" is_paused --rpc "$RPC" 2>/dev/null || true

echo ""
echo "4. Unpause..."
starkli invoke "$DAO_CONTRACT" emergency_unpause \
  --rpc "$RPC" \
  --account "$ACCOUNT" \
  --keystore "$KEYSTORE" \
  --keystore-password "$KEYSTORE_PASSWORD" 2>&1 || echo "  (invoke may fail if not owner)"

echo ""
echo "=== Done ==="
echo "If RPC or account is not configured, set DAO_CONTRACT, RPC, ACCOUNT, KEYSTORE."

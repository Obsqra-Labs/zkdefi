#!/bin/bash
set -euo pipefail
cd /opt/obsqra.starknet/zkdefi/contracts

: "${STARKNET_PRIVATE_KEY:?Set STARKNET_PRIVATE_KEY to the deployer private key}"
PK="${STARKNET_PRIVATE_KEY}"
ACCOUNT="/root/.starkli/accounts/deployer_starkli.json"
RPC="https://free-rpc.nethermind.io/sepolia-juno/v0_7"
OWNER="0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"

echo "=== Step 1: Declare strkBTC ==="
DECLARE_OUT=$(starkli declare target/dev/zkdefi_contracts_StrkBTC.contract_class.json \
  --account "$ACCOUNT" \
  --private-key "$PK" \
  --rpc "$RPC" 2>&1) || true

echo "Declare output:"
echo "$DECLARE_OUT"

echo ""
echo "=== Step 2: Deploy strkBTC ==="
# Get class hash from declare output
CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oP '0x[0-9a-fA-F]{50,}' | head -1)
echo "Using class hash: $CLASS_HASH"

# Constructor: owner, initial_supply_low, initial_supply_high
SUPPLY_LOW="1000000000000000000000000"
SUPPLY_HIGH="0"

starkli deploy "$CLASS_HASH" \
  "$OWNER" \
  "$SUPPLY_LOW" "$SUPPLY_HIGH" \
  --account "$ACCOUNT" \
  --private-key "$PK" \
  --rpc "$RPC" 2>&1

echo ""
echo "=== Done ==="

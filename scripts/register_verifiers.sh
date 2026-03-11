#!/bin/bash
# Register Garaga verifiers with ObsqraFactRegistry
set -euo pipefail

FACT_REGISTRY="0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3"
RPC="http://127.0.0.1:6060"
ACCOUNT="/root/.starkli/accounts/deployer_starkli.json"
KEYSTORE="/root/.starkli/keystore.json"
KEYSTORE_PASSWORD="${KEYSTORE_PASSWORD:-}"

if [ -z "${KEYSTORE_PASSWORD}" ]; then
  echo "ERROR: Set KEYSTORE_PASSWORD in the environment."
  exit 1
fi

echo "=== Registering Reputation Verifiers with FactRegistry ==="
echo "FactRegistry: $FACT_REGISTRY"
echo ""

# Source verifier addresses
source .env.verifiers

echo "1/5 Registering Solvency Verifier: $SOLVENCY_VERIFIER"
starkli invoke "$FACT_REGISTRY" set_solvency_verifier "$SOLVENCY_VERIFIER" \
  --rpc "$RPC" \
  --account "$ACCOUNT" \
  --keystore "$KEYSTORE" \
  --keystore-password "$KEYSTORE_PASSWORD" || echo "  [WARN] Failed or already registered"
sleep 3

echo ""
echo "2/5 Registering Risk Passport Verifier: $RISK_PASSPORT_VERIFIER"
starkli invoke "$FACT_REGISTRY" set_risk_passport_verifier "$RISK_PASSPORT_VERIFIER" \
  --rpc "$RPC" \
  --account "$ACCOUNT" \
  --keystore "$KEYSTORE" \
  --keystore-password "$KEYSTORE_PASSWORD" || echo "  [WARN] Failed or already registered"
sleep 3

echo ""
echo "3/5 Registering Trader Performance Verifier: $TRADER_PERFORMANCE_VERIFIER"
starkli invoke "$FACT_REGISTRY" set_trader_performance_verifier "$TRADER_PERFORMANCE_VERIFIER" \
  --rpc "$RPC" \
  --account "$ACCOUNT" \
  --keystore "$KEYSTORE" \
  --keystore-password "$KEYSTORE_PASSWORD" || echo "  [WARN] Failed or already registered"
sleep 3

echo ""
echo "4/5 Registering Strategy Integrity Verifier: $STRATEGY_INTEGRITY_VERIFIER"
starkli invoke "$FACT_REGISTRY" set_strategy_integrity_verifier "$STRATEGY_INTEGRITY_VERIFIER" \
  --rpc "$RPC" \
  --account "$ACCOUNT" \
  --keystore "$KEYSTORE" \
  --keystore-password "$KEYSTORE_PASSWORD" || echo "  [WARN] Failed or already registered"
sleep 3

echo ""
echo "5/5 Registering Execution Integrity Verifier: $EXECUTION_INTEGRITY_VERIFIER"
starkli invoke "$FACT_REGISTRY" set_execution_integrity_verifier "$EXECUTION_INTEGRITY_VERIFIER" \
  --rpc "$RPC" \
  --account "$ACCOUNT" \
  --keystore "$KEYSTORE" \
  --keystore-password "$KEYSTORE_PASSWORD" || echo "  [WARN] Failed or already registered"

echo ""
echo "=== Verification Registration Complete ==="
echo ""
echo "Verifying verifier addresses..."
echo "Note: starkli call support for reading storage may be limited. Check FactRegistry events for confirmation."

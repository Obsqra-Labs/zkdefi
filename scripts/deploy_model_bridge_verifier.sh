#!/bin/bash
# Deploy ModelBridge Garaga verifier to Starknet Sepolia.
# RPC: Alchemy v2 (no v0_7) to avoid l1_data_gas issues (see contracts/deploy_garaga_verifier.sh, DEPLOYMENT_STATUS.md).
# CASM: use --casm-hash to avoid starkli/Scarb compiler mismatch; set MODEL_BRIDGE_CASM_HASH from declare error if needed.
# Prereq: bash circuits/generate_model_bridge_verifier.sh (builds the verifier).
set -e

echo "=============================================="
echo " DEPLOYING MODELBRIDGE VERIFIER"
echo "=============================================="
echo ""

CONTRACT_NAME="garaga_verifier_model_bridge_Groth16VerifierBN254"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACT_FILE="$REPO_ROOT/circuits/contracts/src/garaga_verifier_model_bridge/target/dev/${CONTRACT_NAME}.contract_class.json"
COMPILED_FILE="$REPO_ROOT/circuits/contracts/src/garaga_verifier_model_bridge/target/dev/${CONTRACT_NAME}.compiled_contract_class.json"

# Alchemy v2 RPC - same as deploy_garaga_verifier.sh (v0_7 rejects l1_data_gas)
RPC_URL="${STARKNET_RPC_URL:-https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7}"
ACCOUNT_FILE="${STARKLI_ACCOUNT:-/root/.starkli-wallets/deployer/account.json}"
KEYSTORE_FILE="${STARKLI_KEYSTORE:-/root/.starkli-wallets/deployer/keystore.json}"

if [ ! -f "$CONTRACT_FILE" ]; then
    echo "Contract not found. Run: bash circuits/generate_model_bridge_verifier.sh"
    exit 1
fi

echo "Contract: $CONTRACT_FILE"
echo "RPC: $RPC_URL (Alchemy v2)"
echo ""

# Declare
echo "Step 1: Declaring..."
if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "No keystore at $KEYSTORE_FILE. Set STARKLI_ACCOUNT and STARKLI_KEYSTORE, or create deployer keystore."
    echo "Then run: STARKNET_KEYSTORE_PASSWORD=<secret> bash scripts/deploy_model_bridge_verifier.sh"
    exit 0
fi
if [ -z "${STARKNET_KEYSTORE_PASSWORD:-}" ]; then
    echo "Set STARKNET_KEYSTORE_PASSWORD and re-run to declare and deploy."
    echo "Example: STARKNET_KEYSTORE_PASSWORD=<secret> bash scripts/deploy_model_bridge_verifier.sh"
    exit 0
fi

# CASM hash: avoid starkli/Scarb compiler mismatch. Prefer env MODEL_BRIDGE_CASM_HASH; else from Scarb's compiled artifact.
if [ -n "${MODEL_BRIDGE_CASM_HASH:-}" ]; then
  CASM_HASH="$MODEL_BRIDGE_CASM_HASH"
elif [ -f "$COMPILED_FILE" ]; then
  CASM_HASH=$(starkli class-hash "$COMPILED_FILE" 2>/dev/null) || true
fi
DECLARE_OPTS=(--account "$ACCOUNT_FILE" --keystore "$KEYSTORE_FILE" --rpc "$RPC_URL")
[ -n "${CASM_HASH:-}" ] && DECLARE_OPTS+=(--casm-hash "$CASM_HASH")
echo "Using CASM hash: ${CASM_HASH:-<none, may hit mismatch>}"
echo ""

set +e
DECLARE_OUT=$(starkli declare "$CONTRACT_FILE" "${DECLARE_OPTS[@]}" 2>&1)
DECLARE_EXIT=$?
set -e

# Only use class hash from successful declare; on failure, show re-run with expected CASM if present
CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oE "0x[0-9a-fA-F]{64}" | head -1)
if [ "$DECLARE_EXIT" -ne 0 ]; then
  echo "$DECLARE_OUT"
  EXPECTED=$(echo "$DECLARE_OUT" | grep -oiE "expected: 0x[0-9a-fA-F]{64}" | head -1)
  if [ -n "$EXPECTED" ]; then
    HASH_VAL=$(echo "$EXPECTED" | grep -oE "0x[0-9a-fA-F]{64}")
    echo ""
    echo "CASM mismatch. Re-run with: MODEL_BRIDGE_CASM_HASH=$HASH_VAL STARKNET_KEYSTORE_PASSWORD=*** bash scripts/deploy_model_bridge_verifier.sh"
    echo "If you see InvalidTransactionNonce, wait 30-60s and retry."
  else
    echo "Declare failed. If no CASM hash was used, ensure circuits/generate_model_bridge_verifier.sh was run and COMPILED_FILE exists."
  fi
  exit 1
fi
if [ -z "$CLASS_HASH" ]; then
  echo "Declare output had no class hash: $DECLARE_OUT"
  exit 1
fi
echo "Class hash: $CLASS_HASH"

echo "Waiting 60s for declaration to propagate..."
sleep 60

# Deploy (no constructor args for Garaga verifier)
echo "Step 2: Deploying..."
set +e
DEPLOY_OUT=$(starkli deploy "$CLASS_HASH" \
    --account "$ACCOUNT_FILE" \
    --keystore "$KEYSTORE_FILE" \
    --rpc "$RPC_URL" \
    2>&1)
DEPLOY_EXIT=$?
set -e
echo "$DEPLOY_OUT"
if [ "$DEPLOY_EXIT" -ne 0 ]; then
    echo "Deploy failed (exit $DEPLOY_EXIT). If 'Class is not declared', wait 30s and retry."
    exit 1
fi
CONTRACT_ADDRESS=$(echo "$DEPLOY_OUT" | grep -iE "deployed at|will be deployed at" | grep -oE "0x[0-9a-fA-F]{64}" | tail -1)
[ -z "$CONTRACT_ADDRESS" ] && CONTRACT_ADDRESS=$(echo "$DEPLOY_OUT" | grep -oE "0x[0-9a-fA-F]{64}" | tail -1)
if [ -z "$CONTRACT_ADDRESS" ]; then
    echo "Could not parse deployed address."
    exit 1
fi

echo ""
echo "=============================================="
echo " MODELBRIDGE VERIFIER DEPLOYED"
echo "=============================================="
echo "Class hash:       $CLASS_HASH"
echo "Contract address: $CONTRACT_ADDRESS"
echo ""

OUT_FILE="$REPO_ROOT/.model_bridge_verifier.deployed"
echo "MODEL_BRIDGE_VERIFIER_CLASS_HASH=$CLASS_HASH" > "$OUT_FILE"
echo "MODEL_BRIDGE_VERIFIER_ADDRESS=$CONTRACT_ADDRESS" >> "$OUT_FILE"
echo "DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_FILE"
echo "Saved to $OUT_FILE"
echo ""
echo "Next: Call set_model_bridge_verifier($CONTRACT_ADDRESS) on ZkmlVerifier (as admin)."
echo "See docs/plans/MODELBRIDGE_VERIFIER_DEPLOY.md for L3 registration."

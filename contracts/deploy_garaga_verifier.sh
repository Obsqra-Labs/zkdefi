#!/usr/bin/env bash
# Deploy Garaga deposit verifier (built from circuits/build/verification_key.json).
# RPC: Cartridge (0.9.0) avoids starkli l1_data_gas / v0_7 incompatibility (see dev_log/entries.md, DEPLOYMENT_STATUS.md).
# Account: Prefer ~/.starkli-wallets/deployer (keystore) on this server; fallback to starkli_config + private_key.txt.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFIER_JSON="${SCRIPT_DIR}/src/garaga_verifier/target/dev/garaga_verifier_Groth16VerifierBN254.contract_class.json"

# Alchemy v2 RPC - starkli deploy works (v0_7 rejects l1_data_gas); same Sepolia so e2e will see contract
RPC="${STARKNET_RPC_URL:-https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7}"

# Prefer server deployer keystore (same account as 0x05fe8125...)
DEPLOYER_ACCOUNT="/root/.starkli-wallets/deployer/account.json"
DEPLOYER_KEYSTORE="/root/.starkli-wallets/deployer/keystore.json"
ACCOUNT="${SCRIPT_DIR}/starkli_config/account.json"
KEY="${SCRIPT_DIR}/starkli_config/private_key.txt"

if [ ! -f "$VERIFIER_JSON" ]; then
  echo "Build verifier first: cd $SCRIPT_DIR/src/garaga_verifier && scarb build"
  exit 1
fi

USE_KEYSTORE=false
if [ -f "$DEPLOYER_ACCOUNT" ] && [ -f "$DEPLOYER_KEYSTORE" ]; then
  ACCOUNT="$DEPLOYER_ACCOUNT"
  USE_KEYSTORE=true
  export STARKNET_KEYSTORE_PASSWORD="${STARKNET_KEYSTORE_PASSWORD:-L!nux123}"
elif [ -f "$ACCOUNT" ] && [ -f "$KEY" ]; then
  PK="$(cat "$KEY")"
  [[ "$PK" != 0x* ]] && PK="0x$PK"
else
  echo "Missing account: use ~/.starkli-wallets/deployer/ (account.json + keystore.json) or contracts/starkli_config/ (account.json + private_key.txt)"
  exit 1
fi

# CASM hash from Scarb build (starkli recompiles with 2.11.4 → mismatch; dev_log/entries.md)
CASM_HASH="${GARAGA_CASM_HASH:-0x477e5392bdb8f9c0424c8b14e18656861f1d678b28445cbb190976325c22a4}"
echo "Declaring Garaga verifier (RPC: $RPC, --casm-hash $CASM_HASH)..."
set +e
if [ "$USE_KEYSTORE" = true ]; then
  DECLARE_OUT=$(starkli declare "$VERIFIER_JSON" --rpc "$RPC" --account "$ACCOUNT" --keystore "$DEPLOYER_KEYSTORE" --casm-hash "$CASM_HASH" 2>&1)
else
  DECLARE_OUT=$(starkli declare "$VERIFIER_JSON" --rpc "$RPC" --account "$ACCOUNT" --private-key "$PK" --casm-hash "$CASM_HASH" 2>&1)
fi
DECLARE_EXIT=$?
set -e
CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1)
if [ "$DECLARE_EXIT" -ne 0 ] || [ -z "$CLASS_HASH" ]; then
  echo "$DECLARE_OUT"
  echo "Declare failed. If CASM mismatch, set GARAGA_CASM_HASH from error message (see dev_log/entries.md)."
  exit 1
fi
echo "Class hash: $CLASS_HASH"

# Declarations need time to propagate before deploy (DEPLOYMENT_STATUS.md). Try 60s on Alchemy v2.
echo "Waiting 60s for declaration to propagate..."
sleep 60

echo "Deploying..."
set +e
if [ "$USE_KEYSTORE" = true ]; then
  DEPLOY_OUT=$(starkli deploy "$CLASS_HASH" --rpc "$RPC" --account "$ACCOUNT" --keystore "$DEPLOYER_KEYSTORE" 2>&1)
else
  DEPLOY_OUT=$(starkli deploy "$CLASS_HASH" --rpc "$RPC" --account "$ACCOUNT" --private-key "$PK" 2>&1)
fi
DEPLOY_EXIT=$?
set -e
echo "$DEPLOY_OUT"
if [ "$DEPLOY_EXIT" -ne 0 ]; then
  echo "Deploy failed (exit $DEPLOY_EXIT). If 'Class is not declared', wait 30s after declare and retry."
  exit 1
fi
# Success: use "will be deployed at" or "deployed at" address
ADDR=$(echo "$DEPLOY_OUT" | grep -iE "deployed at|will be deployed at" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1)
[ -z "$ADDR" ] && ADDR=$(echo "$DEPLOY_OUT" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1)
if [ -z "$ADDR" ]; then
  echo "Could not parse deployed address."
  exit 1
fi
echo "Deployed Garaga verifier: $ADDR"
echo "Set in backend/.env: GARAGA_VERIFIER_ADDRESS=$ADDR"
echo "E2E (same chain Sepolia): GARAGA_VERIFIER_ADDRESS=$ADDR BACKEND_URL=http://localhost:8003 ./run_tests.sh --garaga-onchain-only"

#!/usr/bin/env bash
# Deploy Garaga verifier for FullPrivacyWithdrawWithChange (V2 partial withdraw).
# Uses sncast (not starkli) to avoid RPC l1_data_gas incompatibility with v0.7 endpoints.
# sncast uses deployer account from contracts/snfoundry.toml.
set -e

cd "$(dirname "$0")/.."
for f in .env backend/.env; do
  [ -f "$f" ] && set -a && source "$f" 2>/dev/null && set +a
done

CONTRACT_JSON="circuits/contracts/src/garaga_verifier_with_change/target/dev/garaga_verifier_with_change_Groth16VerifierBN254.contract_class.json"
[ ! -f "$CONTRACT_JSON" ] && { echo "Build verifier first: cd circuits/contracts/src/garaga_verifier_with_change && scarb build"; exit 1; }

echo "=== Declare WithChange verifier (sncast) ==="
cd circuits/contracts/src/garaga_verifier_with_change
cp ../../../../contracts/snfoundry.toml . 2>/dev/null || true
DECLARE_OUT=$(sncast --profile sepolia --wait declare --contract-name Groth16VerifierBN254 2>&1) || true
cd ../../../..
CLASS_HASH=$(echo "$DECLARE_OUT" | grep -E "class_hash|Class hash" | grep -oE '0x[0-9a-fA-F]{64}' | head -1)
[ -z "$CLASS_HASH" ] && CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oE '0x[0-9a-fA-F]{64}' | head -1)
[ -z "$CLASS_HASH" ] && { echo "$DECLARE_OUT"; echo "Declare failed."; exit 1; }
echo "Class hash: $CLASS_HASH"

echo "=== Deploy ==="
cd contracts
DEPLOY_OUT=$(sncast --profile sepolia --wait deploy --class-hash "$CLASS_HASH" 2>&1)
cd ..
echo "$DEPLOY_OUT"
VERIFIER_ADDR=$(echo "$DEPLOY_OUT" | grep -iE "contract address" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1)
[ -z "$VERIFIER_ADDR" ] && VERIFIER_ADDR=$(echo "$DEPLOY_OUT" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1)
[ -z "$VERIFIER_ADDR" ] && { echo "Deploy failed or could not parse address."; exit 1; }
echo "Deployed verifier: $VERIFIER_ADDR"

POOL_ADDR="${FULLY_SHIELDED_POOL_ADDRESS:-}"
[ -z "$POOL_ADDR" ] && [ -f backend/.env ] && POOL_ADDR=$(grep -E "^FULLY_SHIELDED_POOL_ADDRESS=" backend/.env 2>/dev/null | cut -d= -f2- | tr -d '\r')
if [ -n "$POOL_ADDR" ]; then
  echo "=== Set verifier on pool $POOL_ADDR ==="
  cd contracts
  sncast --profile sepolia --wait invoke --contract-address "$POOL_ADDR" --function set_withdraw_with_change_verifier --calldata "$VERIFIER_ADDR" 2>&1
  cd ..
  echo "Done. Set NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS=$POOL_ADDR in frontend/.env.local for partial withdraw UI."
else
  echo "No FULLY_SHIELDED_POOL_ADDRESS. Run: sncast --profile sepolia invoke --contract-address <POOL> --function set_withdraw_with_change_verifier --calldata $VERIFIER_ADDR"
fi

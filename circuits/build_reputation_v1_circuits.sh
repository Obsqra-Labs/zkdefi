#!/usr/bin/env bash
# Build the Reputation V1 "FICO pack" Groth16 circuits.
# Produces wasm, zkeys, and verification keys under circuits/build/.
set -e

cd "$(dirname "$0")"
mkdir -p build

PTAU="pot14_final.ptau"
if [ ! -f "$PTAU" ]; then
  echo "Missing $PTAU. Provide a powers-of-tau file (pot14+ recommended)."
  exit 1
fi

CIRCUITS=(
  "SolvencyProof"
  "RiskPassportTier"
  "TraderPerformanceProof"
  "StrategyIntegrity"
  "ExecutionIntegrity"
)

for CIRCUIT in "${CIRCUITS[@]}"; do
  echo ""
  echo "================================================================"
  echo "=== Building: $CIRCUIT ==="
  echo "================================================================"

  echo "--- Compile $CIRCUIT ---"
  circom "${CIRCUIT}.circom" --r1cs --wasm --sym -o build

  echo "--- Groth16 setup: $CIRCUIT ---"
  npx snarkjs groth16 setup "build/${CIRCUIT}.r1cs" "$PTAU" "build/${CIRCUIT}_0000.zkey"

  echo "--- Contribute: $CIRCUIT ---"
  npx snarkjs zkey contribute "build/${CIRCUIT}_0000.zkey" "build/${CIRCUIT}_final.zkey" \
    --name="zkDefi-ReputationV1" -e="zkdefi-reputation-v1-${CIRCUIT}" -v

  echo "--- Export vkey: $CIRCUIT ---"
  npx snarkjs zkey export verificationkey "build/${CIRCUIT}_final.zkey" "build/${CIRCUIT}_verification_key.json"

  echo "=== Done: $CIRCUIT ==="
done

echo ""
echo "================================================================"
echo "=== Reputation V1 build complete ==="
echo "================================================================"

for CIRCUIT in "${CIRCUITS[@]}"; do
  WASM="build/${CIRCUIT}_js/${CIRCUIT}.wasm"
  ZKEY="build/${CIRCUIT}_final.zkey"
  VKEY="build/${CIRCUIT}_verification_key.json"

  if [ -f "$WASM" ] && [ -f "$ZKEY" ] && [ -f "$VKEY" ]; then
    echo "  ✓ $CIRCUIT: wasm + zkey + vkey"
  else
    echo "  ✗ $CIRCUIT: missing artifact(s)"
    [ ! -f "$WASM" ] && echo "      Missing: $WASM"
    [ ! -f "$ZKEY" ] && echo "      Missing: $ZKEY"
    [ ! -f "$VKEY" ] && echo "      Missing: $VKEY"
  fi
done

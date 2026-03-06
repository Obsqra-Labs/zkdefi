#!/usr/bin/env bash
# Build the 8 identity-bound agent circuits for Garaga Groth16.
# Produces circuits/build/ with _js/, _final.zkey, and verification keys
# matching the pattern expected by backend circuit_scanner.py + groth16_prover.py.
set -e

cd "$(dirname "$0")"
mkdir -p build

PTAU="pot14_final.ptau"
if [ ! -f "$PTAU" ]; then
  echo "Missing $PTAU. Use a powers-of-tau file with power sufficient for circuit (e.g. pot14)."
  exit 1
fi

CIRCUITS=(
  "ImpermanentLossPredictor"
  "YieldOptimality"
  "SlippageBound"
  "AgentReputationScore"
  "CrossProtocolArbitrage"
  "LiquidationRisk"
  "HistoricalPerformanceAttestation"
  "MEVResistanceProof"
)

for CIRCUIT in "${CIRCUITS[@]}"; do
  echo ""
  echo "================================================================"
  echo "=== Building: $CIRCUIT ==="
  echo "================================================================"

  # Compile
  echo "--- Compile $CIRCUIT ---"
  circom "${CIRCUIT}.circom" --r1cs --wasm --sym -o build

  # Groth16 setup
  echo "--- Groth16 setup: $CIRCUIT ---"
  npx snarkjs groth16 setup "build/${CIRCUIT}.r1cs" "$PTAU" "build/${CIRCUIT}_0000.zkey"

  # Phase 2 contribution
  echo "--- Contribute: $CIRCUIT ---"
  npx snarkjs zkey contribute "build/${CIRCUIT}_0000.zkey" "build/${CIRCUIT}_final.zkey" \
    --name="zkDefi-Agent-Contrib" -e="zkdefi-agent-entropy-${CIRCUIT}" -v

  # Export verification key
  echo "--- Export vkey: $CIRCUIT ---"
  npx snarkjs zkey export verificationkey "build/${CIRCUIT}_final.zkey" "build/${CIRCUIT}_verification_key.json"

  echo "=== Done: $CIRCUIT ==="
done

echo ""
echo "================================================================"
echo "=== All agent circuits built ==="
echo "================================================================"
echo ""
echo "Build artifacts:"
for CIRCUIT in "${CIRCUITS[@]}"; do
  WASM="build/${CIRCUIT}_js/${CIRCUIT}.wasm"
  ZKEY="build/${CIRCUIT}_final.zkey"
  VKEY="build/${CIRCUIT}_verification_key.json"

  if [ -f "$WASM" ] && [ -f "$ZKEY" ] && [ -f "$VKEY" ]; then
    echo "  ✓ $CIRCUIT: wasm + zkey + vkey"
  else
    echo "  ✗ $CIRCUIT: MISSING ARTIFACTS"
    [ ! -f "$WASM" ] && echo "      Missing: $WASM"
    [ ! -f "$ZKEY" ] && echo "      Missing: $ZKEY"
    [ ! -f "$VKEY" ] && echo "      Missing: $VKEY"
  fi
done

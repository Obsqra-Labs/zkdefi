#!/usr/bin/env bash
# Build ModelBridge circuit: compile → PoT → Groth16 setup → export vkey
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
CIRCUIT_NAME="ModelBridge"
mkdir -p "$BUILD_DIR"

echo "[1/5] Compiling ${CIRCUIT_NAME}.circom..."
circom "$SCRIPT_DIR/${CIRCUIT_NAME}.circom" \
  --r1cs --wasm --sym \
  -l "$SCRIPT_DIR/node_modules" \
  -o "$BUILD_DIR"

echo "[2/5] Checking Powers of Tau..."
# Use existing ptau if available, otherwise generate
POT="$BUILD_DIR/pot14.ptau"
if [ ! -f "$POT" ]; then
  # Check if a smaller pot exists
  if [ -f "$BUILD_DIR/pot12.ptau" ]; then
    POT="$BUILD_DIR/pot12.ptau"
    echo "    Using existing pot12.ptau"
  else
    echo "    Generating pot14.ptau (this takes a moment)..."
    npx snarkjs powersoftau new bn128 14 "$BUILD_DIR/pot14_0.ptau" -v
    ENTROPY="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "$ENTROPY" | npx snarkjs powersoftau contribute \
      "$BUILD_DIR/pot14_0.ptau" "$BUILD_DIR/pot14_1.ptau" \
      --name="obsqra-model-bridge" -v
    npx snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot14_1.ptau" "$POT" -v
    rm -f "$BUILD_DIR/pot14_0.ptau" "$BUILD_DIR/pot14_1.ptau"
  fi
fi

echo "[3/5] Groth16 setup..."
npx snarkjs groth16 setup \
  "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" "$POT" \
  "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"

ENTROPY2="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
echo "$ENTROPY2" | npx snarkjs zkey contribute \
  "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" \
  "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
  --name="obsqra-model-bridge-contribution" -v

echo "[4/5] Export verification key..."
npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
  "$BUILD_DIR/${CIRCUIT_NAME}_verification_key.json"

echo "[5/5] Verify setup..."
npx snarkjs zkey verify \
  "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" "$POT" \
  "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey"

echo ""
echo "=== ModelBridge circuit built successfully ==="
echo "  r1cs:  $BUILD_DIR/${CIRCUIT_NAME}.r1cs"
echo "  wasm:  $BUILD_DIR/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"
echo "  zkey:  $BUILD_DIR/${CIRCUIT_NAME}_final.zkey"
echo "  vkey:  $BUILD_DIR/${CIRCUIT_NAME}_verification_key.json"

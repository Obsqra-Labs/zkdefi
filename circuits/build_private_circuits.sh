#!/usr/bin/env bash
# Build PrivateDeposit and PrivateWithdraw circuits for Garaga Groth16.
# Produces circuits/build/ with _js/, _final.zkey, and verification keys
# expected by backend/app/services/groth16_prover.py.
set -e

cd "$(dirname "$0")"
mkdir -p build

PTAU="pot14_final.ptau"
if [ ! -f "$PTAU" ]; then
  echo "Missing $PTAU. Use a powers-of-tau file with power sufficient for circuit (e.g. pot14)."
  exit 1
fi

echo "=== Compile PrivateDeposit ==="
circom PrivateDeposit.circom --r1cs --wasm --sym -o build

echo "=== Compile PrivateWithdraw ==="
circom PrivateWithdraw.circom --r1cs --wasm --sym -o build

echo "=== Groth16 setup: PrivateDeposit ==="
npx snarkjs groth16 setup build/PrivateDeposit.r1cs "$PTAU" build/PrivateDeposit_0000.zkey
npx snarkjs zkey contribute build/PrivateDeposit_0000.zkey build/PrivateDeposit_final.zkey --name="Contrib" -e="random-entropy" -v
npx snarkjs zkey export verificationkey build/PrivateDeposit_final.zkey build/verification_key.json

echo "=== Groth16 setup: PrivateWithdraw ==="
npx snarkjs groth16 setup build/PrivateWithdraw.r1cs "$PTAU" build/PrivateWithdraw_0000.zkey
npx snarkjs zkey contribute build/PrivateWithdraw_0000.zkey build/PrivateWithdraw_final.zkey --name="Contrib" -e="random-entropy" -v
npx snarkjs zkey export verificationkey build/PrivateWithdraw_final.zkey build/PrivateWithdraw_verification_key.json

echo "=== Done ==="
echo "Build contains:"
ls -la build/PrivateDeposit_js/PrivateDeposit.wasm build/PrivateWithdraw_js/PrivateWithdraw.wasm \
  build/PrivateDeposit_final.zkey build/PrivateWithdraw_final.zkey \
  build/verification_key.json build/PrivateWithdraw_verification_key.json 2>/dev/null || true

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

echo "=== Compile FullPrivacyWithdraw ==="
circom FullPrivacyWithdraw.circom --r1cs --wasm --sym -o build

echo "=== Compile FullPrivacyWithdrawWithChange ==="
circom FullPrivacyWithdrawWithChange.circom --r1cs --wasm --sym -o build

echo "=== Groth16 setup: PrivateDeposit ==="
npx snarkjs groth16 setup build/PrivateDeposit.r1cs "$PTAU" build/PrivateDeposit_0000.zkey
npx snarkjs zkey contribute build/PrivateDeposit_0000.zkey build/PrivateDeposit_final.zkey --name="Contrib" -e="random-entropy" -v
npx snarkjs zkey export verificationkey build/PrivateDeposit_final.zkey build/verification_key.json

echo "=== Groth16 setup: PrivateWithdraw ==="
npx snarkjs groth16 setup build/PrivateWithdraw.r1cs "$PTAU" build/PrivateWithdraw_0000.zkey
npx snarkjs zkey contribute build/PrivateWithdraw_0000.zkey build/PrivateWithdraw_final.zkey --name="Contrib" -e="random-entropy" -v
npx snarkjs zkey export verificationkey build/PrivateWithdraw_final.zkey build/PrivateWithdraw_verification_key.json

echo "=== Groth16 setup: FullPrivacyWithdraw ==="
npx snarkjs groth16 setup build/FullPrivacyWithdraw.r1cs "$PTAU" build/FullPrivacyWithdraw_0000.zkey
npx snarkjs zkey contribute build/FullPrivacyWithdraw_0000.zkey build/FullPrivacyWithdraw_final.zkey --name="Contrib" -e="random-entropy" -v
npx snarkjs zkey export verificationkey build/FullPrivacyWithdraw_final.zkey build/FullPrivacyWithdraw_vkey.json

echo "=== Groth16 setup: FullPrivacyWithdrawWithChange ==="
npx snarkjs groth16 setup build/FullPrivacyWithdrawWithChange.r1cs "$PTAU" build/FullPrivacyWithdrawWithChange_0000.zkey
npx snarkjs zkey contribute build/FullPrivacyWithdrawWithChange_0000.zkey build/FullPrivacyWithdrawWithChange_final.zkey --name="Contrib" -e="random-entropy" -v
npx snarkjs zkey export verificationkey build/FullPrivacyWithdrawWithChange_final.zkey build/FullPrivacyWithdrawWithChange_verification_key.json

echo "=== Done ==="
echo "Build contains:"
ls -la build/PrivateDeposit_js/PrivateDeposit.wasm build/PrivateWithdraw_js/PrivateWithdraw.wasm \
  build/FullPrivacyWithdraw_js/FullPrivacyWithdraw.wasm build/FullPrivacyWithdrawWithChange_js/FullPrivacyWithdrawWithChange.wasm \
  build/PrivateDeposit_final.zkey build/PrivateWithdraw_final.zkey \
  build/FullPrivacyWithdraw_final.zkey build/FullPrivacyWithdrawWithChange_final.zkey \
  build/verification_key.json build/PrivateWithdraw_verification_key.json \
  build/FullPrivacyWithdraw_vkey.json build/FullPrivacyWithdrawWithChange_verification_key.json 2>/dev/null || true

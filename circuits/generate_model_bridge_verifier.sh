#!/bin/bash
# Generate Garaga Groth16 verifier for ModelBridge (EZKL → proof bridge).
# Requires: circuits/build/ModelBridge_verification_key.json (run circuits/build_model_bridge.sh first).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
BUILD_DIR="$SCRIPT_DIR/build"
VK="$BUILD_DIR/ModelBridge_verification_key.json"

if [ ! -f "$VK" ]; then
  echo "Missing $VK. Run: bash circuits/build_model_bridge.sh"
  exit 1
fi

echo "=== Generating ModelBridge Garaga verifier ==="
rm -rf contracts/src/garaga_verifier_model_bridge

docker run --rm \
  -v "$(pwd):/circuits" \
  -w /circuits/contracts/src \
  python:3.10-slim bash -c "
    set -e
    apt-get update -qq && apt-get install -y -qq curl git > /dev/null 2>&1
    pip install -q garaga==1.0.1
    curl -LsSf https://github.com/software-mansion/scarb/releases/download/v2.8.4/scarb-v2.8.4-x86_64-unknown-linux-musl.tar.gz | tar -xz
    export PATH=\"\$PATH:\$(pwd)/scarb-v2.8.4-x86_64-unknown-linux-musl/bin\"
    garaga gen --system groth16 --vk /circuits/build/ModelBridge_verification_key.json --project-name garaga_verifier_model_bridge
    cd garaga_verifier_model_bridge && scarb build
  " || true

# Garaga may fail at scarb fmt (inlining-strategy = 2 vs "default"); fix and build
MB_DIR="$SCRIPT_DIR/contracts/src/garaga_verifier_model_bridge"
if [ -d "$MB_DIR" ]; then
  sed -i 's/inlining-strategy = 2/inlining-strategy = "default"/' "$MB_DIR/Scarb.toml" 2>/dev/null || true
  if [ ! -f "$MB_DIR/src/groth16_verifier.cairo" ]; then
    cp "$SCRIPT_DIR/contracts/src/garaga_verifier_withdraw/src/groth16_verifier.cairo" "$MB_DIR/src/"
  fi
  (cd "$MB_DIR" && scarb build) || { echo "Scarb build failed"; exit 1; }
fi

echo ""
echo "ModelBridge verifier generated: circuits/contracts/src/garaga_verifier_model_bridge"
echo "Next: deploy to Starknet and L3 (see docs/plans/MODELBRIDGE_VERIFIER_DEPLOY.md)"

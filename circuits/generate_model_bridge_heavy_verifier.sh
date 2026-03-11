#!/bin/bash
# Generate Garaga Groth16 verifier for ModelBridgeHeavy (heavier EZKL → proof bridge).
# Requires: circuits/build/ModelBridgeHeavy_verification_key.json (run circuits/build_model_bridge_heavy.sh first).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
BUILD_DIR="$SCRIPT_DIR/build"
VK="$BUILD_DIR/ModelBridgeHeavy_verification_key.json"

if [ ! -f "$VK" ]; then
  echo "Missing $VK. Run: bash circuits/build_model_bridge_heavy.sh"
  exit 1
fi

echo "=== Generating ModelBridgeHeavy Garaga verifier ==="
rm -rf contracts/src/garaga_verifier_model_bridge_heavy

docker run --rm \
  -v "$(pwd):/circuits" \
  -w /circuits/contracts/src \
  python:3.10-slim bash -c "
    set -e
    apt-get update -qq && apt-get install -y -qq curl git > /dev/null 2>&1
    pip install -q garaga==1.0.1
    curl -LsSf https://github.com/software-mansion/scarb/releases/download/v2.8.4/scarb-v2.8.4-x86_64-unknown-linux-musl.tar.gz | tar -xz
    export PATH=\"\$PATH:\$(pwd)/scarb-v2.8.4-x86_64-unknown-linux-musl/bin\"
    garaga gen --system groth16 --vk /circuits/build/ModelBridgeHeavy_verification_key.json --project-name garaga_verifier_model_bridge_heavy
    cd garaga_verifier_model_bridge_heavy && scarb build
  " || true

# Garaga may fail at scarb fmt (inlining-strategy = 2 vs "default"); fix and build
MBH_DIR="$SCRIPT_DIR/contracts/src/garaga_verifier_model_bridge_heavy"
if [ -d "$MBH_DIR" ]; then
  sed -i 's/inlining-strategy = 2/inlining-strategy = "default"/' "$MBH_DIR/Scarb.toml" 2>/dev/null || true
  if [ ! -f "$MBH_DIR/src/groth16_verifier.cairo" ]; then
    cp "$SCRIPT_DIR/contracts/src/garaga_verifier_withdraw/src/groth16_verifier.cairo" "$MBH_DIR/src/" 2>/dev/null || \
    cp "$SCRIPT_DIR/contracts/src/garaga_verifier_model_bridge/src/groth16_verifier.cairo" "$MBH_DIR/src/" 2>/dev/null || true
  fi
  (cd "$MBH_DIR" && scarb build) || { echo "Scarb build failed"; exit 1; }
fi

echo ""
echo "ModelBridgeHeavy verifier generated: circuits/contracts/src/garaga_verifier_model_bridge_heavy"
echo "Artifacts: target/dev/garaga_verifier_model_bridge_heavy_Groth16VerifierBN254.contract_class.json (Sierra) and .compiled_contract_class.json (CASM)"
echo "Next: deploy to L3 (parent backend deploy_verifiers_l3.py); set L3_MODEL_BRIDGE_HEAVY_VERIFIER_ADDRESS in .env"

#!/usr/bin/env bash
# Generate Garaga Groth16 verifier for FullPrivacyWithdrawWithChange (V2 partial withdraw).
# Requires: circuits/build/FullPrivacyWithdrawWithChange_verification_key.json (run build_private_circuits.sh first).
set -e

cd "$(dirname "$0")"

if [ ! -f build/FullPrivacyWithdrawWithChange_verification_key.json ]; then
  echo "Missing build/FullPrivacyWithdrawWithChange_verification_key.json. Run: ./build_private_circuits.sh"
  exit 1
fi

echo "=== Generating Garaga verifier for FullPrivacyWithdrawWithChange ==="
rm -rf contracts/src/garaga_verifier_with_change

docker run --rm \
  -v "$(pwd):/circuits" \
  -w /circuits/contracts/src \
  python:3.10-slim bash -c "
    set -e
    apt-get update -qq && apt-get install -y -qq curl git > /dev/null 2>&1
    pip install -q garaga==1.0.1
    GGEN=/usr/local/lib/python3.10/site-packages/garaga/starknet/groth16_contract_generator/generator.py
    [ -f \"\$GGEN\" ] && sed -i 's/inlining-strategy = {inlining_level}/inlining-strategy = \"default\"/' \"\$GGEN\" || true
    curl -sL https://github.com/software-mansion/scarb/releases/download/v2.9.2/scarb-v2.9.2-x86_64-unknown-linux-gnu.tar.gz | tar -xz
    export PATH=\"\$PATH:\$(pwd)/scarb-v2.9.2-x86_64-unknown-linux-gnu/bin\"
    garaga gen --system groth16 --vk /circuits/build/FullPrivacyWithdrawWithChange_verification_key.json --project-name garaga_verifier_with_change
    cd garaga_verifier_with_change && (scarb build || true)
    ls -la target/dev/ 2>/dev/null || true
  "
echo ""
echo "If scarb build failed in Docker (version conflict), build on host:"
echo "  cd circuits/contracts/src/garaga_verifier_with_change && scarb build"

echo ""
echo "Verifier generated at circuits/contracts/src/garaga_verifier_with_change"
echo "To deploy: starkli declare then starkli deploy from that dir (or copy to zkdefi/contracts and deploy)."
echo "Then call set_withdraw_with_change_verifier(verifier_address) on the pool."

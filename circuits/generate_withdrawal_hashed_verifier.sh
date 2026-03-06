#!/bin/bash
set -e

echo "=== Generating Hashed Withdrawal Verifier (Tier-2H) ==="
echo ""

cd /opt/obsqra.starknet/zkdefi/circuits

# Remove old verifier if exists
rm -rf contracts/src/garaga_verifier_withdraw_hashed

echo "Generating verifier from FullPrivacyWithdrawHashed VK..."

# Use Docker with Python 3.10 + garaga
docker run --rm \
  -v "$(pwd):/circuits" \
  -w /circuits/contracts/src \
  python:3.10-slim bash -c "
    set -e
    echo 'Installing dependencies...'
    apt-get update -qq && apt-get install -y -qq curl git > /dev/null 2>&1
    pip install -q garaga==1.0.1
    
    echo 'Installing scarb...'
    curl -L https://github.com/software-mansion/scarb/releases/download/v2.8.4/scarb-v2.8.4-x86_64-unknown-linux-musl.tar.gz | tar -xz
    export PATH=\"\$PATH:\$(pwd)/scarb-v2.8.4-x86_64-unknown-linux-musl/bin\"
    
    echo 'Generating Garaga verifier for FullPrivacyWithdrawHashed...'
    garaga gen --system groth16 --vk /circuits/build/FullPrivacyWithdrawHashed_verification_key.json --project-name garaga_verifier_withdraw_hashed
    
    echo 'Building verifier...'
    cd garaga_verifier_withdraw_hashed
    scarb build
  "

echo ""
echo "✅ Hashed withdrawal verifier generated!"
echo ""
echo "Artifacts:"
ls -lh contracts/src/garaga_verifier_withdraw_hashed/target/dev/*.json 2>/dev/null | grep -i "contract_class"
echo ""
echo "Next: Deploy this verifier to Sepolia and set FULL_PRIVACY_WITHDRAW_HASHED_VERIFIER_ADDRESS"

#!/bin/bash
set -e

echo "=== Garaga Verifier Redeployment Script ==="
echo ""

# 1. Regenerate Garaga verifier from current VK
echo "Step 1: Regenerating Garaga verifier from current VK..."
cd /opt/obsqra.starknet/zkdefi/circuits

# Remove old verifier
rm -rf contracts/src/garaga_verifier_new

# Use Docker with Python 3.10 + garaga + scarb
docker run --rm \
  -v "$(pwd):/circuits" \
  -w /circuits/contracts/src \
  python:3.10-slim bash -c "
    set -e
    echo 'Installing dependencies...'
    apt-get update -qq && apt-get install -y -qq curl git > /dev/null 2>&1
    pip install -q garaga==1.0.1
    
    # Scarb 2.8+ expects inlining-strategy string; garaga 1.0.1 writes integer 2
    GGEN=/usr/local/lib/python3.10/site-packages/garaga/starknet/groth16_contract_generator/generator.py
    sed -i 's/inlining-strategy = {inlining_level}/inlining-strategy = \"default\"/' \"\$GGEN\"
    
    echo 'Installing scarb...'
    curl -sL https://github.com/software-mansion/scarb/releases/download/v2.9.2/scarb-v2.9.2-x86_64-unknown-linux-gnu.tar.gz | tar -xz
    export PATH=\"\$PATH:\$(pwd)/scarb-v2.9.2-x86_64-unknown-linux-gnu/bin\"
    
    echo 'Generating Garaga verifier...'
    garaga gen --system groth16 --vk /circuits/build/verification_key.json --project-name garaga_verifier_new
    
    echo 'Building verifier contract...'
    cd garaga_verifier_new
    scarb build
    
    echo 'Garaga verifier generated and built!'
    ls -la target/dev/
  "

echo ""
echo "Step 2: If Docker scarb build failed: copy garaga_verifier_new/src/*.cairo to zkdefi/contracts/src/garaga_verifier/src/ and run scarb build from zkdefi/contracts."
echo ""
echo "Step 3: Deploy to Starknet Sepolia"
echo "Please run the following commands manually:"
echo ""
echo "  cd /opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_new"
echo "  starkli declare target/dev/garaga_verifier_new_Groth16Verifier.contract_class.json --rpc https://starknet-sepolia.g.alchemy.com/v2/YOUR_KEY"
echo "  starkli deploy <CLASS_HASH> --rpc https://starknet-sepolia.g.alchemy.com/v2/YOUR_KEY"
echo ""
echo "Then update backend/.env with:"
echo "  GARAGA_VERIFIER_ADDRESS=<new_contract_address>"
echo ""
echo "And redeploy ConfidentialTransfer contract with the new verifier address."

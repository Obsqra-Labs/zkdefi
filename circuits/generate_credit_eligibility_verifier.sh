#!/bin/bash
set -e

echo "=== Generating CreditEligibility Verifier ==="
echo ""

cd /opt/obsqra.starknet/zkdefi/circuits

rm -rf contracts/src/garaga_verifier_credit_eligibility

echo "Generating verifier from CreditEligibility VK..."

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
    
    echo 'Generating Garaga verifier for CreditEligibility...'
    garaga gen --system groth16 --vk /circuits/build/CreditEligibility_verification_key.json --project-name garaga_verifier_credit_eligibility
    
    echo 'Building verifier...'
    cd garaga_verifier_credit_eligibility
    scarb build
  "

echo ""
echo "CreditEligibility verifier generated!"
echo ""
echo "Artifacts:"
ls -lh contracts/src/garaga_verifier_credit_eligibility/target/dev/*.json 2>/dev/null | grep -i "contract_class"
echo ""
echo "Next: Deploy this verifier to Sepolia and wire into LendingPool"

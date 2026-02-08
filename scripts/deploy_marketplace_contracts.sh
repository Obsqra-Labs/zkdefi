#!/bin/bash
# Deploy zkML Marketplace Contracts - ModelRegistry and AgentComposer
# Requires starkli and account/keystore setup

set -e

# Configuration
NETWORK="${NETWORK:-sepolia}"
ACCOUNT_FILE="${ACCOUNT_FILE:-/opt/obsqra.starknet/zkdefi/contracts/accounts.json}"
KEYSTORE="${KEYSTORE:-/opt/obsqra.starknet/zkdefi/contracts/keystore.json}"

echo "=== Deploying zkML Marketplace Contracts to $NETWORK ==="
echo ""

cd /opt/obsqra.starknet/zkdefi/contracts

# Build contracts
echo "Building contracts..."
scarb build

echo ""
echo "Declaring and deploying contracts..."

# Declare ModelRegistry
echo "Declaring ModelRegistry..."
starkli declare \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE \
    --network $NETWORK \
    target/dev/zkdefi_contracts_ModelRegistry.contract_class.json || true

# Declare AgentComposer
echo "Declaring AgentComposer..."
starkli declare \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE \
    --network $NETWORK \
    target/dev/zkdefi_contracts_AgentComposer.contract_class.json || true

echo ""
echo "=== Contract artifacts built successfully ==="
echo "Use starkli to deploy with your account and keystore"
echo ""
echo "Available artifacts:"
ls -la target/dev/zkdefi_contracts_ModelRegistry.contract_class.json
ls -la target/dev/zkdefi_contracts_AgentComposer.contract_class.json

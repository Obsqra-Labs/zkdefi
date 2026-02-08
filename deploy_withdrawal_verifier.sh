#!/bin/bash
# Deploy Withdrawal Verifier - Exact same method as Agent Orchestrator (Jan 29)
set -e

echo "=============================================="
echo " DEPLOYING WITHDRAWAL VERIFIER"
echo "=============================================="
echo ""

# Configuration (same as successful Agent Orchestrator deployment)
CONTRACT_NAME="garaga_verifier_withdraw_Groth16VerifierBN254"
CONTRACT_FILE="/opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_withdraw/target/dev/${CONTRACT_NAME}.contract_class.json"
RPC_URL="https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7"
ACCOUNT_FILE="/root/.starkli-wallets/deployer/account.json"
KEYSTORE_FILE="/root/.starkli-wallets/deployer/keystore.json"

# Check if contract exists
if [ ! -f "$CONTRACT_FILE" ]; then
    echo "❌ Contract not found at: $CONTRACT_FILE"
    exit 1
fi

echo "✅ Contract file: $CONTRACT_FILE"
echo ""

# Step 1: Declare
echo "📝 Step 1: Declaring contract..."
export STARKNET_KEYSTORE_PASSWORD='L!nux123'
CLASS_HASH=$(starkli declare "$CONTRACT_FILE" \
    --account "$ACCOUNT_FILE" \
    --keystore "$KEYSTORE_FILE" \
    --rpc "$RPC_URL" \
    2>&1 | grep -oE "0x[0-9a-f]{64}" | head -1)

if [ -z "$CLASS_HASH" ]; then
    echo "❌ Declaration failed. Trying to get existing class hash..."
    CLASS_HASH=$(starkli class-hash "$CONTRACT_FILE")
fi

echo "✅ Class Hash: $CLASS_HASH"
echo ""

# Step 2: Deploy
echo "📝 Step 2: Deploying contract (no constructor args)"
echo ""

CONTRACT_ADDRESS=$(starkli deploy "$CLASS_HASH" \
    --account "$ACCOUNT_FILE" \
    --keystore "$KEYSTORE_FILE" \
    --rpc "$RPC_URL" \
    2>&1 | grep -oE "0x[0-9a-f]{64}" | tail -1)

echo ""
echo "=============================================="
echo " DEPLOYMENT COMPLETE"
echo "=============================================="
echo ""
echo "Class Hash:       $CLASS_HASH"
echo "Contract Address: $CONTRACT_ADDRESS"
echo ""

# Save to file
echo "WITHDRAWAL_VERIFIER_CLASS_HASH=$CLASS_HASH" > /opt/obsqra.starknet/zkdefi/.withdrawal_verifier.deployed
echo "WITHDRAWAL_VERIFIER_ADDRESS=$CONTRACT_ADDRESS" >> /opt/obsqra.starknet/zkdefi/.withdrawal_verifier.deployed
echo "DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /opt/obsqra.starknet/zkdefi/.withdrawal_verifier.deployed

echo "✅ Deployment info saved to .withdrawal_verifier.deployed"
echo ""
echo "Next: Deploy ConfidentialTransfer with both verifier addresses"

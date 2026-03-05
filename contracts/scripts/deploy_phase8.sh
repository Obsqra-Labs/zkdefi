#!/bin/bash
set -e

# Phase 8 Contract Deployment Script
# Deploys: ObsqraFactRegistry, ReceiptRegistry
# Updates: VaultController configuration

echo "🚀 Phase 8 Contract Deployment"
echo "=============================="
echo ""

# Check prerequisites
if ! command -v starkli &> /dev/null; then
    echo "❌ starkli not found. Install: https://github.com/xJonathanLEI/starkli"
    exit 1
fi

# Load environment
if [ -f "../.env" ]; then
    export $(cat ../env | xargs)
else
    echo "❌ .env file not found"
    exit 1
fi

# Configuration
ADMIN_ADDRESS=${STARKNET_ADMIN_ADDRESS:-""}
VAULT_CONTROLLER=${VAULT_CONTROLLER_ADDRESS:-"0x6c5b17eab7f20da1ab69e98db6f3f63cbcefa28992a17787883c76dd13498d1"}
RPC_URL=${STARKNET_RPC_URL:-"https://starknet-sepolia.public.blastapi.io/rpc/v0_7"}

if [ -z "$ADMIN_ADDRESS" ]; then
    echo "❌ STARKNET_ADMIN_ADDRESS not set in .env"
    exit 1
fi

echo "Admin Address: $ADMIN_ADDRESS"
echo "VaultController: $VAULT_CONTROLLER"
echo "RPC URL: $RPC_URL"
echo ""

# Step 1: Deploy ObsqraFactRegistry
echo "📝 Step 1: Deploying ObsqraFactRegistry..."
echo "===========================================" 

# Declare class
echo "Declaring contract class..."
FACT_REGISTRY_CLASS_HASH=$(starkli declare \
    target/dev/zkdefi_contracts_ObsqraFactRegistry.contract_class.json \
    --rpc $RPC_URL \
    2>&1 | tee /dev/tty | grep -oP 'Class hash declared: \K0x[0-9a-fA-F]+')

if [ -z "$FACT_REGISTRY_CLASS_HASH" ]; then
    echo "❌ Failed to declare ObsqraFactRegistry"
    exit 1
fi

echo "✅ Class hash: $FACT_REGISTRY_CLASS_HASH"

# Deploy contract
echo "Deploying contract..."
FACT_REGISTRY_ADDRESS=$(starkli deploy \
    $FACT_REGISTRY_CLASS_HASH \
    $ADMIN_ADDRESS \
    --rpc $RPC_URL \
    2>&1 | tee /dev/tty | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+')

if [ -z "$FACT_REGISTRY_ADDRESS" ]; then
    echo "❌ Failed to deploy ObsqraFactRegistry"
    exit 1
fi

echo "✅ ObsqraFactRegistry deployed: $FACT_REGISTRY_ADDRESS"
echo ""

# Verify deployment
echo "Verifying deployment..."
ADMIN_CHECK=$(starkli call $FACT_REGISTRY_ADDRESS get_admin --rpc $RPC_URL 2>&1 || echo "error")

if [[ "$ADMIN_CHECK" == *"error"* ]]; then
    echo "⚠️  Warning: Could not verify admin address"
else
    echo "✅ Admin verified: $ADMIN_CHECK"
fi

echo ""

# Step 2: Deploy ReceiptRegistry
echo "📝 Step 2: Deploying ReceiptRegistry..."
echo "========================================="

# Declare class
echo "Declaring contract class..."
RECEIPT_REGISTRY_CLASS_HASH=$(starkli declare \
    target/dev/zkdefi_contracts_ReceiptRegistry.contract_class.json \
    --rpc $RPC_URL \
    2>&1 | tee /dev/tty | grep -oP 'Class hash declared: \K0x[0-9a-fA-F]+')

if [ -z "$RECEIPT_REGISTRY_CLASS_HASH" ]; then
    echo "❌ Failed to declare ReceiptRegistry"
    exit 1
fi

echo "✅ Class hash: $RECEIPT_REGISTRY_CLASS_HASH"

# Deploy contract
echo "Deploying contract..."
RECEIPT_REGISTRY_ADDRESS=$(starkli deploy \
    $RECEIPT_REGISTRY_CLASS_HASH \
    $ADMIN_ADDRESS \
    --rpc $RPC_URL \
    2>&1 | tee /dev/tty | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+')

if [ -z "$RECEIPT_REGISTRY_ADDRESS" ]; then
    echo "❌ Failed to deploy ReceiptRegistry"
    exit 1
fi

echo "✅ ReceiptRegistry deployed: $RECEIPT_REGISTRY_ADDRESS"
echo ""

# Step 3: Authorize VaultController
echo "📝 Step 3: Authorizing VaultController..."
echo "==========================================="

echo "Setting VaultController as authorized caller..."
starkli invoke \
    $RECEIPT_REGISTRY_ADDRESS \
    set_authorized_caller \
    $VAULT_CONTROLLER \
    1 \
    --rpc $RPC_URL

echo "✅ VaultController authorized"
echo ""

# Step 4: Configure VaultController
echo "📝 Step 4: Configuring VaultController..."
echo "=========================================="

# Note: Requires VaultController to have setter functions
# If not present, skip this step and configure manually

echo "⚠️  Manual step required:"
echo "Call VaultController.set_fact_registry($FACT_REGISTRY_ADDRESS)"
echo "Call VaultController.set_receipt_registry($RECEIPT_REGISTRY_ADDRESS)"
echo ""

# Step 5: Save addresses
echo "📝 Step 5: Saving Deployment Addresses..."
echo "=========================================="

cat > ../deployment_addresses.txt << EOF
# Phase 8 Deployment Addresses (Sepolia)
# Deployed: $(date)

FACT_REGISTRY_ADDRESS=$FACT_REGISTRY_ADDRESS
RECEIPT_REGISTRY_ADDRESS=$RECEIPT_REGISTRY_ADDRESS
VAULT_CONTROLLER_ADDRESS=$VAULT_CONTROLLER

# Class Hashes
FACT_REGISTRY_CLASS_HASH=$FACT_REGISTRY_CLASS_HASH
RECEIPT_REGISTRY_CLASS_HASH=$RECEIPT_REGISTRY_CLASS_HASH
EOF

echo "✅ Addresses saved to ../deployment_addresses.txt"
echo ""

# Step 6: Update backend .env
echo "📝 Step 6: Updating Backend Configuration..."
echo "============================================="

if [ -f "../backend/.env" ]; then
    # Backup existing
    cp ../backend/.env ../backend/.env.backup
    
    # Update or append addresses
    if grep -q "FACT_REGISTRY_ADDRESS" ../backend/.env; then
        sed -i "s|^FACT_REGISTRY_ADDRESS=.*|FACT_REGISTRY_ADDRESS=$FACT_REGISTRY_ADDRESS|" ../backend/.env
    else
        echo "FACT_REGISTRY_ADDRESS=$FACT_REGISTRY_ADDRESS" >> ../backend/.env
    fi
    
    if grep -q "RECEIPT_REGISTRY_ADDRESS" ../backend/.env; then
        sed -i "s|^RECEIPT_REGISTRY_ADDRESS=.*|RECEIPT_REGISTRY_ADDRESS=$RECEIPT_REGISTRY_ADDRESS|" ../backend/.env
    else
        echo "RECEIPT_REGISTRY_ADDRESS=$RECEIPT_REGISTRY_ADDRESS" >> ../backend/.env
    fi
    
    echo "✅ Backend .env updated"
else
    echo "⚠️  Backend .env not found, skipping"
fi

echo ""

# Step 7: Update frontend .env.local
echo "📝 Step 7: Updating Frontend Configuration..."
echo "==============================================="

if [ -f "../frontend/.env.local" ]; then
    # Backup existing
    cp ../frontend/.env.local ../frontend/.env.local.backup
    
    # Update or append addresses
    if grep -q "NEXT_PUBLIC_FACT_REGISTRY_ADDRESS" ../frontend/.env.local; then
        sed -i "s|^NEXT_PUBLIC_FACT_REGISTRY_ADDRESS=.*|NEXT_PUBLIC_FACT_REGISTRY_ADDRESS=$FACT_REGISTRY_ADDRESS|" ../frontend/.env.local
    else
        echo "NEXT_PUBLIC_FACT_REGISTRY_ADDRESS=$FACT_REGISTRY_ADDRESS" >> ../frontend/.env.local
    fi
    
    if grep -q "NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS" ../frontend/.env.local; then
        sed -i "s|^NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS=.*|NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS=$RECEIPT_REGISTRY_ADDRESS|" ../frontend/.env.local
    else
        echo "NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS=$RECEIPT_REGISTRY_ADDRESS" >> ../frontend/.env.local
    fi
    
    echo "✅ Frontend .env.local updated"
else
    echo "⚠️  Frontend .env.local not found, skipping"
fi

echo ""

# Summary
echo "🎉 Phase 8 Deployment Complete!"
echo "================================"
echo ""
echo "Deployed Contracts:"
echo "  ObsqraFactRegistry:   $FACT_REGISTRY_ADDRESS"
echo "  ReceiptRegistry:      $RECEIPT_REGISTRY_ADDRESS"
echo ""
echo "Voyager Links (Sepolia):"
echo "  https://sepolia.voyager.online/contract/$FACT_REGISTRY_ADDRESS"
echo "  https://sepolia.voyager.online/contract/$RECEIPT_REGISTRY_ADDRESS"
echo ""
echo "Next Steps:"
echo "  1. Verify contracts on Voyager"
echo "  2. Configure VaultController (manual step)"
echo "  3. Restart backend: pm2 restart zkdefi-backend"
echo "  4. Restart frontend: cd frontend && npm run build && pm2 restart zkdefi-frontend"
echo "  5. Run E2E tests"
echo ""

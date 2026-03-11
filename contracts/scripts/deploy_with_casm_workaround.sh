#!/bin/bash
# Deploy zkDeFi contracts with CASM hash workaround
# Based on /opt/obsqra.starknet/deploy_contracts_alchemy.sh

set -euo pipefail

CONTRACTS_DIR="/opt/obsqra.starknet/zkdefi/contracts"
RPC_URL="http://127.0.0.1:6060"
ACCOUNT_PATH="/root/.starkli/accounts/deployer_starkli.json"
PRIVATE_KEY="${STARKNET_PRIVATE_KEY:-${PRIVATE_KEY:-}}"

if [ -z "${PRIVATE_KEY}" ]; then
    echo "ERROR: Set STARKNET_PRIVATE_KEY (or PRIVATE_KEY) in the environment."
    exit 1
fi

echo "========================================="
echo "zkDeFi Contract Deployment (CASM Workaround)"
echo "========================================="
echo "RPC: $RPC_URL"
echo ""

# Function to extract expected CASM hash from error
extract_casm_hash() {
    local error_msg="$1"
    echo "$error_msg" | grep -oP 'Expected: 0x\K[a-f0-9]{1,64}' | head -1
}

# Function to declare contract with CASM hash workaround
declare_contract() {
    local contract_name="$1"
    local sierra_file="$2"
    
    echo "[*] Declaring $contract_name..."
    echo "    Sierra: $sierra_file"
    
    # Try to declare (will fail with CASM mismatch)
    echo "    [1/2] Extracting expected CASM hash..."
    local error_output=$(starkli declare "$sierra_file" \
        --account "$ACCOUNT_PATH" \
        --private-key "$PRIVATE_KEY" \
        --rpc "$RPC_URL" 2>&1 || true)
    
    # Extract expected CASM hash
    local expected_hash=$(echo "$error_output" | grep -oP 'Expected: 0x\K[a-f0-9]{1,64}' | head -1)
    
    if [ -z "$expected_hash" ]; then
        # Maybe it succeeded or was already declared
        echo "$error_output" | grep -q "Class hash declared" && {
            echo "[✓] Already declared or successful!"
            local class_hash=$(echo "$error_output" | grep -oP '0x[a-f0-9]{63,64}' | head -1)
            echo "    Class Hash: $class_hash"
            echo "$class_hash"
            return 0
        }
        
        echo "[✗] Could not extract CASM hash"
        echo "Error: $error_output"
        return 1
    fi
    
    echo "    Expected CASM: 0x$expected_hash"
    echo "    [2/2] Declaring with --casm-hash..."
    
    # Declare with correct hash
    local output=$(starkli declare "$sierra_file" \
        --casm-hash "0x$expected_hash" \
        --account "$ACCOUNT_PATH" \
        --private-key "$PRIVATE_KEY" \
        --rpc "$RPC_URL" 2>&1)
    
    local class_hash=$(echo "$output" | grep -oP '0x[a-f0-9]{63,64}' | head -1)
    
    if [ -z "$class_hash" ]; then
        echo "[✗] Declaration failed"
        echo "$output"
        return 1
    fi
    
    echo "[✓] Declared successfully!"
    echo "    Class Hash: $class_hash"
    echo "$class_hash"
}

# Function to deploy contract
deploy_contract() {
    local contract_name="$1"
    local class_hash="$2"
    shift 2
    local constructor_args="$@"
    
    echo "[*] Deploying $contract_name..."
    echo "    Class Hash: $class_hash"
    
    if [ -n "$constructor_args" ]; then
        echo "    Constructor Args: $constructor_args"
    fi
    
    local output=$(starkli deploy "$class_hash" $constructor_args \
        --account "$ACCOUNT_PATH" \
        --private-key "$PRIVATE_KEY" \
        --rpc "$RPC_URL" 2>&1)
    
    local contract_address=$(echo "$output" | grep -oP '0x[a-f0-9]{63,64}' | tail -1)
    
    if [ -z "$contract_address" ]; then
        echo "[✗] Deployment failed"
        echo "$output"
        return 1
    fi
    
    echo "[✓] Deployed successfully!"
    echo "    Contract Address: $contract_address"
    echo "$contract_address"
}

# Deploy ReceiptRegistry
echo ""
echo "=== ReceiptRegistry ==="
RECEIPT_CLASS=$(declare_contract "ReceiptRegistry" "$CONTRACTS_DIR/target/dev/zkdefi_contracts_ReceiptRegistry.contract_class.json")
if [ -n "$RECEIPT_CLASS" ]; then
    ADMIN_ADDRESS="0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
    RECEIPT_ADDRESS=$(deploy_contract "ReceiptRegistry" "$RECEIPT_CLASS" "$ADMIN_ADDRESS")
    echo "ReceiptRegistry deployed at: $RECEIPT_ADDRESS"
fi

echo ""
echo "=== DAOConstraintManager ==="
DAO_CLASS=$(declare_contract "DAOConstraintManager" "$CONTRACTS_DIR/target/dev/zkdefi_contracts_DAOConstraintManager.contract_class.json")
if [ -n "$DAO_CLASS" ]; then
    ADMIN_ADDRESS="0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
    DAO_ADDRESS=$(deploy_contract "DAOConstraintManager" "$DAO_CLASS" "$ADMIN_ADDRESS")
    echo "DAOConstraintManager deployed at: $DAO_ADDRESS"
fi

echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "ReceiptRegistry: $RECEIPT_ADDRESS"
echo "DAOConstraintManager: $DAO_ADDRESS"

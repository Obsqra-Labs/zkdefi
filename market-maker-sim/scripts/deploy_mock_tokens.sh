#!/usr/bin/env bash
# Deploy zkdETH, zkdAI, and MarketController to Starknet Sepolia
# Usage: ./deploy_mock_tokens.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$SCRIPT_DIR/../contracts"
ROOT_DIR="$SCRIPT_DIR/.."

# ---- Config ----
RPC_URL="https://api.cartridge.gg/x/starknet/sepolia"
ACCOUNT="deployer"
ACCOUNT_FILE="${HOME}/.starknet_accounts/starknet_open_zeppelin_accounts.json"
OWNER_ADDRESS="0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"

# Token names as felt252 (short strings)
# 'zkdETH' = 0x7a6b64455448
# 'zkdAI'  = 0x7a6b644149
ZKDETH_NAME="0x7a6b64455448"
ZKDETH_SYMBOL="0x7a6b64455448"
ZKDAI_NAME="0x7a6b644149"
ZKDAI_SYMBOL="0x7a6b644149"

# Peg price: 2000 * 10^18 in hex
PEG_PRICE_X18_LOW="0x6c6b935b8bbd400000"
PEG_PRICE_X18_HIGH="0x0"

# Artifacts
TOKEN_CLASS="$CONTRACTS_DIR/target/dev/market_maker_sim_contracts_zkd_token.contract_class.json"
CONTROLLER_CLASS="$CONTRACTS_DIR/target/dev/market_maker_sim_contracts_market_controller.contract_class.json"

OUTPUT_FILE="$ROOT_DIR/deployed_addresses.json"

echo "======================================"
echo "  zkDeFi Mock Token Deployment"
echo "  Network: Sepolia"
echo "======================================"

# ---- Build if not already built ----
if [[ ! -f "$TOKEN_CLASS" ]]; then
    echo ">> Building contracts..."
    cd "$CONTRACTS_DIR" && scarb build
    cd "$SCRIPT_DIR"
fi

# ---- Declare zkd_token ----
echo ""
echo ">> Declaring zkd_token..."
DECLARE_TOKEN=$(sncast --account "$ACCOUNT" --url "$RPC_URL" \
    --accounts-file "$ACCOUNT_FILE" \
    declare --contract-name zkd_token \
    --package market_maker_sim_contracts 2>&1 || true)
echo "$DECLARE_TOKEN"

TOKEN_CLASS_HASH=$(echo "$DECLARE_TOKEN" | grep -oP 'class_hash: \K0x[a-fA-F0-9]+' || true)
if [[ -z "$TOKEN_CLASS_HASH" ]]; then
    # Already declared — extract from error
    TOKEN_CLASS_HASH=$(echo "$DECLARE_TOKEN" | grep -oP '0x[a-fA-F0-9]{50,}' | head -1 || true)
    echo "   (likely already declared: $TOKEN_CLASS_HASH)"
fi
echo "   Token class hash: $TOKEN_CLASS_HASH"

echo ">> Waiting 15s for declaration to propagate..."
sleep 15

# ---- Deploy zkdETH ----
echo ""
echo ">> Deploying zkdETH..."
DEPLOY_ZKDETH=$(sncast --account "$ACCOUNT" --url "$RPC_URL" \
    --accounts-file "$ACCOUNT_FILE" \
    deploy --class-hash "$TOKEN_CLASS_HASH" \
    --constructor-calldata "$OWNER_ADDRESS" "$ZKDETH_NAME" "$ZKDETH_SYMBOL" 2>&1)
echo "$DEPLOY_ZKDETH"
ZKDETH_ADDRESS=$(echo "$DEPLOY_ZKDETH" | grep -oP 'contract_address: \K0x[a-fA-F0-9]+' || true)
echo "   zkdETH address: $ZKDETH_ADDRESS"

echo ">> Waiting 10s..."
sleep 10

# ---- Deploy zkdAI ----
echo ""
echo ">> Deploying zkdAI..."
DEPLOY_ZKDAI=$(sncast --account "$ACCOUNT" --url "$RPC_URL" \
    --accounts-file "$ACCOUNT_FILE" \
    deploy --class-hash "$TOKEN_CLASS_HASH" \
    --constructor-calldata "$OWNER_ADDRESS" "$ZKDAI_NAME" "$ZKDAI_SYMBOL" 2>&1)
echo "$DEPLOY_ZKDAI"
ZKDAI_ADDRESS=$(echo "$DEPLOY_ZKDAI" | grep -oP 'contract_address: \K0x[a-fA-F0-9]+' || true)
echo "   zkdAI address: $ZKDAI_ADDRESS"

echo ">> Waiting 10s..."
sleep 10

# ---- Declare market_controller ----
echo ""
echo ">> Declaring market_controller..."
DECLARE_CTRL=$(sncast --account "$ACCOUNT" --url "$RPC_URL" \
    --accounts-file "$ACCOUNT_FILE" \
    declare --contract-name market_controller \
    --package market_maker_sim_contracts 2>&1 || true)
echo "$DECLARE_CTRL"

CTRL_CLASS_HASH=$(echo "$DECLARE_CTRL" | grep -oP 'class_hash: \K0x[a-fA-F0-9]+' || true)
if [[ -z "$CTRL_CLASS_HASH" ]]; then
    CTRL_CLASS_HASH=$(echo "$DECLARE_CTRL" | grep -oP '0x[a-fA-F0-9]{50,}' | head -1 || true)
    echo "   (likely already declared: $CTRL_CLASS_HASH)"
fi
echo "   Controller class hash: $CTRL_CLASS_HASH"

echo ">> Waiting 15s..."
sleep 15

# ---- Deploy MarketController ----
echo ""
echo ">> Deploying MarketController..."
DEPLOY_CTRL=$(sncast --account "$ACCOUNT" --url "$RPC_URL" \
    --accounts-file "$ACCOUNT_FILE" \
    deploy --class-hash "$CTRL_CLASS_HASH" \
    --constructor-calldata "$OWNER_ADDRESS" "$ZKDETH_ADDRESS" "$ZKDAI_ADDRESS" "$PEG_PRICE_X18_LOW" "$PEG_PRICE_X18_HIGH" 2>&1)
echo "$DEPLOY_CTRL"
CTRL_ADDRESS=$(echo "$DEPLOY_CTRL" | grep -oP 'contract_address: \K0x[a-fA-F0-9]+' || true)
echo "   Controller address: $CTRL_ADDRESS"

# ---- Save addresses ----
cat > "$OUTPUT_FILE" <<EOF
{
  "network": "sepolia",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "token_class_hash": "$TOKEN_CLASS_HASH",
  "controller_class_hash": "$CTRL_CLASS_HASH",
  "zkdETH": "$ZKDETH_ADDRESS",
  "zkdAI": "$ZKDAI_ADDRESS",
  "market_controller": "$CTRL_ADDRESS",
  "owner": "$OWNER_ADDRESS"
}
EOF

echo ""
echo "======================================"
echo "  Deployment Complete!"
echo "======================================"
echo "  zkdETH:            $ZKDETH_ADDRESS"
echo "  zkdAI:             $ZKDAI_ADDRESS"
echo "  MarketController:  $CTRL_ADDRESS"
echo ""
echo "  Addresses saved to: $OUTPUT_FILE"
echo "======================================"

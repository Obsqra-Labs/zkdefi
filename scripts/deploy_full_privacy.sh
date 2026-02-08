#!/bin/bash
# Deploy Full Privacy Pool Contracts

set -e

cd /opt/obsqra.starknet/zkdefi/contracts

export STARKNET_RPC="https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7"
: "${STARKNET_KEYSTORE_PASSWORD:?Set STARKNET_KEYSTORE_PASSWORD in env (do not commit)}"

ADMIN="0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
TOKEN="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
MERKLE_TREE="0x05ebfd6cc0a7b58c170d8a96bfa353b38a772ea4eea3d291e1d7d2abf584fa88"

echo "=== Declaring FullyShieldedPool ==="
# First attempt to get CASM hash
OUTPUT=$(starkli declare target/dev/zkdefi_contracts_FullyShieldedPool.contract_class.json \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json 2>&1 || true)

echo "$OUTPUT"

# Extract expected CASM hash if there was a mismatch
EXPECTED_HASH=$(echo "$OUTPUT" | grep "Expected:" | sed 's/.*Expected: //' | tr -d '",')

if [ -n "$EXPECTED_HASH" ]; then
    echo "Using CASM hash: $EXPECTED_HASH"
    starkli declare target/dev/zkdefi_contracts_FullyShieldedPool.contract_class.json \
      --casm-hash $EXPECTED_HASH \
      --account ~/.starkli-wallets/deployer/account.json \
      --keystore ~/.starkli-wallets/deployer/keystore.json \
      --watch
fi

echo ""
read -p "Enter FullyShieldedPool class hash: " POOL_CLASS

echo "=== Deploying FullyShieldedPool ==="
echo "Constructor: merkle_tree=$MERKLE_TREE, withdraw_verifier=0x0, token=$TOKEN, admin=$ADMIN"
starkli deploy $POOL_CLASS $MERKLE_TREE 0x0 $TOKEN $ADMIN \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --watch

echo ""
read -p "Enter deployed FullyShieldedPool address: " POOL_ADDRESS

echo "=== Authorizing pool as merkle inserter ==="
starkli invoke $MERKLE_TREE add_inserter $POOL_ADDRESS \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --watch

echo ""
echo "=== Deployment Complete ==="
echo "MerkleTree: $MERKLE_TREE"
echo "FullyShieldedPool: $POOL_ADDRESS"

# Update env files
echo "MERKLE_TREE_ADDRESS=$MERKLE_TREE" >> ../backend/.env
echo "FULLY_SHIELDED_POOL_ADDRESS=$POOL_ADDRESS" >> ../backend/.env
echo "NEXT_PUBLIC_MERKLE_TREE_ADDRESS=$MERKLE_TREE" >> ../frontend/.env.local
echo "NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=$POOL_ADDRESS" >> ../frontend/.env.local

echo "Environment files updated!"

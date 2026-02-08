#!/bin/bash
# Deploy MerkleTree (with add_known_root) and FullyShieldedPool pointing to it.
# Use this for Full Privacy so the backend can register BN254 roots via add_known_root
# and avoid "Unknown merkle root" on withdraw.
#
# For an existing pool that uses an old tree without add_known_root, you must
# redeploy: run this script to get a new tree + pool, then point backend/frontend
# at the new addresses.

set -e

cd "$(dirname "$0")/../contracts"

# Optional: override via env
export STARKNET_RPC="${STARKNET_RPC:-https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7}"
: "${STARKNET_KEYSTORE_PASSWORD:?Set STARKNET_KEYSTORE_PASSWORD in env (do not commit)}"

ADMIN="${ADMIN:-0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d}"
TOKEN="${TOKEN:-0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d}"

echo "=== Build contracts ==="
scarb build

echo ""
echo "=== 1. Declare MerkleTree ==="
OUTPUT=$(starkli declare target/dev/zkdefi_contracts_MerkleTree.contract_class.json \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json 2>&1 || true)
echo "$OUTPUT"
EXPECTED_HASH=$(echo "$OUTPUT" | grep "Expected:" | sed 's/.*Expected: //' | tr -d '",')
if [ -n "$EXPECTED_HASH" ]; then
  echo "Using CASM hash: $EXPECTED_HASH"
  starkli declare target/dev/zkdefi_contracts_MerkleTree.contract_class.json \
    --casm-hash "$EXPECTED_HASH" \
    --account ~/.starkli-wallets/deployer/account.json \
    --keystore ~/.starkli-wallets/deployer/keystore.json \
    --watch
fi

echo ""
read -p "Enter MerkleTree class hash: " MERKLE_CLASS

echo "=== 2. Deploy MerkleTree (constructor: admin) ==="
starkli deploy "$MERKLE_CLASS" "$ADMIN" \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --watch

echo ""
read -p "Enter deployed MerkleTree address: " MERKLE_TREE

echo "=== 3. Declare FullyShieldedPool ==="
OUTPUT=$(starkli declare target/dev/zkdefi_contracts_FullyShieldedPool.contract_class.json \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json 2>&1 || true)
echo "$OUTPUT"
EXPECTED_HASH=$(echo "$OUTPUT" | grep "Expected:" | sed 's/.*Expected: //' | tr -d '",')
if [ -n "$EXPECTED_HASH" ]; then
  echo "Using CASM hash: $EXPECTED_HASH"
  starkli declare target/dev/zkdefi_contracts_FullyShieldedPool.contract_class.json \
    --casm-hash "$EXPECTED_HASH" \
    --account ~/.starkli-wallets/deployer/account.json \
    --keystore ~/.starkli-wallets/deployer/keystore.json \
    --watch
fi

echo ""
read -p "Enter FullyShieldedPool class hash: " POOL_CLASS

echo "=== 4. Deploy FullyShieldedPool (merkle_tree=$MERKLE_TREE, withdraw_verifier=0x0, token=$TOKEN, admin=$ADMIN) ==="
starkli deploy "$POOL_CLASS" "$MERKLE_TREE" 0x0 "$TOKEN" "$ADMIN" \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --watch

echo ""
read -p "Enter deployed FullyShieldedPool address: " POOL_ADDRESS

echo "=== 5. Authorize pool as merkle inserter ==="
starkli invoke "$MERKLE_TREE" add_inserter "$POOL_ADDRESS" \
  --account ~/.starkli-wallets/deployer/account.json \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --watch

echo ""
echo "=== Deployment Complete ==="
echo "MerkleTree (with add_known_root): $MERKLE_TREE"
echo "FullyShieldedPool: $POOL_ADDRESS"
echo ""
echo "Backend: set FULL_PRIVACY_MERKLE_TREE_ADDRESS=$MERKLE_TREE and admin key/address"
echo "so the backend can call add_known_root after register_commitment (see docs/ENV.md)."

# Update env files (append; remove duplicates manually if re-running)
echo "MERKLE_TREE_ADDRESS=$MERKLE_TREE" >> ../backend/.env
echo "FULLY_SHIELDED_POOL_ADDRESS=$POOL_ADDRESS" >> ../backend/.env
echo "NEXT_PUBLIC_MERKLE_TREE_ADDRESS=$MERKLE_TREE" >> ../frontend/.env.local
echo "NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=$POOL_ADDRESS" >> ../frontend/.env.local
echo "Environment files updated."

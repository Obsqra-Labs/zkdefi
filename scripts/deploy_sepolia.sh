#!/usr/bin/env bash
# Deploy zkdefi contracts to Starknet Sepolia.
# Uses Integrity fact registry + real ERC20 token (no mocks).
# Prerequisites: scarb build, starkli or sncast, funded account.
set -e
cd "$(dirname "$0")/.."
CONTRACTS_DIR="$(pwd)/contracts"

# Load .env if present
if [ -f .env ]; then export $(grep -v '^#' .env | xargs); fi

RPC_URL="${STARKNET_RPC_URL:-https://starknet-sepolia.public.blastapi.io}"
ACCOUNTS_FILE="${ACCOUNTS_FILE:-$HOME/.starknet_accounts/starknet_open_zeppelin_accounts.json}"
ACCOUNT="${DEPLOYER_ACCOUNT:-deployer}"

# Required: Integrity fact registry (Obsqra prover submits proofs here), ERC20 token, admin
INTEGRITY_FACT_REGISTRY="${INTEGRITY_FACT_REGISTRY_ADDRESS:-}"
ERC20_TOKEN="${ERC20_TOKEN_ADDRESS:-}"
ADMIN="${ADMIN_ADDRESS:-}"

if [ -z "$INTEGRITY_FACT_REGISTRY" ] || [ -z "$ERC20_TOKEN" ] || [ -z "$ADMIN" ]; then
  echo "Set INTEGRITY_FACT_REGISTRY_ADDRESS, ERC20_TOKEN_ADDRESS, and ADMIN_ADDRESS."
  echo "Integrity fact registry on Sepolia: use Obsqra Labs / existing SHARP fact registry address."
  echo "ERC20: deploy a minimal ERC20 or use an existing Sepolia token address."
  echo "ADMIN: deployer address or desired admin (ContractAddress as hex)."
  exit 1
fi

echo "Building contracts..."
cd "$CONTRACTS_DIR" && scarb build
cd "$CONTRACTS_DIR"

# Contract class names (Scarb artifact names; adjust if your build output differs)
# ProofGatedYieldAgent(fact_registry, token, admin)
# SelectiveDisclosure(fact_registry, admin)
# ConfidentialTransfer(garaga_verifier, token, admin) — deploy Garaga verifier separately first

echo "Deploying ProofGatedYieldAgent (fact_registry=$INTEGRITY_FACT_REGISTRY, token=$ERC20_TOKEN, admin=$ADMIN)..."
AGENT_DEPLOY=$(sncast --url "$RPC_URL" --accounts-file "$ACCOUNTS_FILE" --account "$ACCOUNT" deploy \
  --name zkdefi_contracts_ProofGatedYieldAgent_ProofGatedYieldAgent \
  --constructor-calldata "$INTEGRITY_FACT_REGISTRY" "$ERC20_TOKEN" "$ADMIN" 2>/dev/null || true)
AGENT_ADDRESS="${PROOF_GATED_AGENT_ADDRESS:-}"

echo "Deploying SelectiveDisclosure (fact_registry=$INTEGRITY_FACT_REGISTRY, admin=$ADMIN)..."
DISCLOSURE_DEPLOY=$(sncast --url "$RPC_URL" --accounts-file "$ACCOUNTS_FILE" --account "$ACCOUNT" deploy \
  --name zkdefi_contracts_SelectiveDisclosure_SelectiveDisclosure \
  --constructor-calldata "$INTEGRITY_FACT_REGISTRY" "$ADMIN" 2>/dev/null || true)
DISCLOSURE_ADDRESS="${SELECTIVE_DISCLOSURE_ADDRESS:-}"

# ConfidentialTransfer requires Garaga verifier to be deployed first (from circuits/ build)
GARAGA_VERIFIER="${GARAGA_VERIFIER_ADDRESS:-}"
if [ -n "$GARAGA_VERIFIER" ]; then
  echo "Deploying ConfidentialTransfer (garaga_verifier=$GARAGA_VERIFIER, token=$ERC20_TOKEN, admin=$ADMIN)..."
  CONF_DEPLOY=$(sncast --url "$RPC_URL" --accounts-file "$ACCOUNTS_FILE" --account "$ACCOUNT" deploy \
    --name zkdefi_contracts_ConfidentialTransfer_ConfidentialTransfer \
    --constructor-calldata "$GARAGA_VERIFIER" "$ERC20_TOKEN" "$ADMIN" 2>/dev/null || true)
  CONFIDENTIAL_ADDRESS="${CONFIDENTIAL_TRANSFER_ADDRESS:-}"
else
  echo "GARAGA_VERIFIER_ADDRESS not set. Deploy Garaga verifier from circuits/ then set it and re-run for ConfidentialTransfer."
  CONFIDENTIAL_ADDRESS=""
fi

echo ""
echo "--- Set these in backend/.env and frontend/.env.local ---"
echo "STARKNET_RPC_URL=$RPC_URL"
echo "PROOF_GATED_AGENT_ADDRESS=<from sncast deploy output above>"
echo "SELECTIVE_DISCLOSURE_ADDRESS=<from sncast deploy output above>"
echo "CONFIDENTIAL_TRANSFER_ADDRESS=<from sncast deploy output above if Garaga deployed>"
echo "GARAGA_VERIFIER_ADDRESS=$GARAGA_VERIFIER"
echo "INTEGRITY_FACT_REGISTRY_ADDRESS=$INTEGRITY_FACT_REGISTRY"
echo "ERC20_TOKEN_ADDRESS=$ERC20_TOKEN"
echo ""
echo "See docs/SETUP.md for full deployment steps and constructor calldata format."

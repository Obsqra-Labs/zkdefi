#!/bin/bash
set -euo pipefail

cd /opt/obsqra.starknet/zkdefi/contracts

# Never hardcode private keys in repository files.
# Usage:
#   STARKNET_PRIVATE_KEY=0x... ./declare_strkbtc.sh
: "${STARKNET_PRIVATE_KEY:?Set STARKNET_PRIVATE_KEY to the deployer private key}"

starkli declare target/dev/zkdefi_contracts_StrkBTC.contract_class.json \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key "${STARKNET_PRIVATE_KEY}" \
  --rpc https://free-rpc.nethermind.io/sepolia-juno/v0_7

#!/bin/bash
cd /opt/obsqra.starknet/zkdefi/contracts
starkli declare target/dev/zkdefi_contracts_StrkBTC.contract_class.json \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key 0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc \
  --rpc https://free-rpc.nethermind.io/sepolia-juno/v0_7

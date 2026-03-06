# zkde.fi v2 Deployment Complete

**Date:** February 3, 2026
**Network:** Starknet Sepolia

## Deployed Contracts

### ReputationRegistry
- **Address:** `0x0276979a6b7341d7b3bdf157669c4e3b04886cfb5b5816cd5f82a9cd855a0092`
- **Class Hash:** `0x057632aeae7b92886c56b5d71432d0338468379d5e324fbd8c21f19a617e8293`
- **Explorer:** https://sepolia.starkscan.co/contract/0x0276979a6b7341d7b3bdf157669c4e3b04886cfb5b5816cd5f82a9cd855a0092

### AllocationRouter
- **Address:** `0x01bdc88d6530e11ba0a41f3210925b0326e67706570d2f63ad8bb01905a9d507`
- **Class Hash:** `0x00472813dbcf7492076a93265e8305ec5d9b74579d4c74c4b67f68039cff76c4`
- **Explorer:** https://sepolia.starkscan.co/contract/0x01bdc88d6530e11ba0a41f3210925b0326e67706570d2f63ad8bb01905a9d507

### BatchVerifier
- **Address:** `0x0051607327530643fb71b631cff2f650fea4baad654519dd2c63eb0fb52846d7`
- **Class Hash:** `0x0092069a057447a23907cd6e935489a3f6d04fcfd2c1a08330118d9b1909bfa6`
- **Explorer:** https://sepolia.starkscan.co/contract/0x0051607327530643fb71b631cff2f650fea4baad654519dd2c63eb0fb52846d7

### TieredAgentController
- **Address:** `0x04f209421d466ddb61a64cb42f35f3e840591c8942af372959a4bba1d23ae53e`
- **Class Hash:** `0x053579a442d6bd00864ce0b3b5d156f32a179cbb4577d605a33cbb281c75cd11`
- **Explorer:** https://sepolia.starkscan.co/contract/0x04f209421d466ddb61a64cb42f35f3e840591c8942af372959a4bba1d23ae53e

### Relayer
- **Address:** `0x00b9760334cb444bf8e1ca191721f96fd67ab9bb40f23438fc085ca87a65757c`
- **Class Hash:** `0x06a77880caaa5cb7af95cc988ffe5295be8428250740810a63cf08b169931fc0`
- **Explorer:** https://sepolia.starkscan.co/contract/0x00b9760334cb444bf8e1ca191721f96fd67ab9bb40f23438fc085ca87a65757c

## Deployment Method

Used starkli with --casm-hash override as documented in RPC_CASM_HASH_FIX.md.

## Environment Variables

```bash
REPUTATION_REGISTRY_ADDRESS=0x0276979a6b7341d7b3bdf157669c4e3b04886cfb5b5816cd5f82a9cd855a0092
ALLOCATION_ROUTER_ADDRESS=0x01bdc88d6530e11ba0a41f3210925b0326e67706570d2f63ad8bb01905a9d507
BATCH_VERIFIER_ADDRESS=0x0051607327530643fb71b631cff2f650fea4baad654519dd2c63eb0fb52846d7
TIERED_AGENT_ADDRESS=0x04f209421d466ddb61a64cb42f35f3e840591c8942af372959a4bba1d23ae53e
RELAYER_ADDRESS=0x00b9760334cb444bf8e1ca191721f96fd67ab9bb40f23438fc085ca87a65757c
```

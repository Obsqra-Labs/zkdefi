# Contract Deployment Status

## Successfully Deployed Contracts (Sepolia)

All ERC-8004 aligned contracts are now deployed and verified on Starknet Sepolia:

| Contract | Class Hash | Deployed Address | Status |
|----------|------------|------------------|--------|
| **ModelRegistry** | `0x06b5169475a8c6b887933690f377341bb438df7b3a66a85b50313a4308df9504` | `0x06ab2595007be01ffb7e51bd28339f870be36402eed9034b109fd479e7469adc` | ✅ Live |
| **AgentComposer** | `0x024f832c1170dcb4fac626fc5a3d064faff2d43b58ba973ed1ae415bf4bed039` | `0x0639eda1b05238d21183cbf2dab7bfca793978d534d608d992577dcdccb0a84d` | ✅ Live |
| **AgentIdentity** | `0x56bfddb434992e97170c4954e161b68f3077004567e5fa5e3c44e1c54805d99` | `0x06b2ed4153d620f5558086de5afff8a5bb0de76720deb26c8a037cb347aff80a` | ✅ Live |
| **ValidationProofRegistry** | `0x7ab6af3551f6b021191d5a66e1b520ef07cd83bf66b40ef1c633c340c6e6e5a` | `0x02e2b175026aa2f9cf804d84a92076fcf9c29149bb009305f26d4be74ae03492` | ✅ Live |
| **ReputationRegistry** | `0x74f7c06bfa0ba09af8e172467a7be78fa2077b7f4fb1fad8dbeda8eec60c95f` | `0x0428700cc719df6ef6104123f6a326dde0f4f42f7e41f941473338bc31f9ccff` | ✅ Live |

## RPC Compatibility Resolution

### Issue
The original tooling (`starknet_py 0.29.0`, `starkli 0.4.2`) required RPC spec version 0.10.0, but public nodes were running:
- PublicNode: 0.8.1
- Alchemy: 0.7.1
- BlastAPI: deprecated

This caused errors like `unknown block tag 'pre_confirmed'` and `Input too long for arguments`.

### Solution
Used **Cartridge RPC** (`https://api.cartridge.gg/x/starknet/sepolia`) which runs version 0.9.0 - close enough for `sncast 0.53.0` to work with a warning.

**Key findings:**
1. The `deployer` account (not `deployer_sepolia`) had the correct private key
2. `sncast` from Starknet Foundry handled the 0.9.0 RPC version gracefully
3. Declarations need ~30s to propagate before deployment works

### Recommended RPC Configuration
```toml
# snfoundry.toml
[sncast.sepolia]
account = "deployer"
url = "https://api.cartridge.gg/x/starknet/sepolia"
```

## Contract Features

### AgentIdentity (SRC-721)
- Agent minting with identity commitment linkage
- Reputation tier tracking
- Execution counting
- Active/inactive state management
- Discovery by owner, tier, commitment

### ValidationProofRegistry
- Proof registration with agent linkage
- Proof invalidation
- Discovery by agent, proof type, action type
- Authorized verifier management

### ReputationRegistry Enhancements
- `get_reputation_score(user)` - Returns 0-1000 score
- `get_top_users(limit)` - Leaderboard functionality
- `get_user_rank(user)` - Position in ranking
- `get_users_by_tier(tier)` - Filter by proof tier
- `get_total_users()` - Total registered users

Score calculation: tenure_points + txn_points + collateral_points + proof_count_points

## ERC-8004 Alignment

zkde.fi now implements a Starknet-native version of the ERC-8004 agent trust framework:

| ERC-8004 Component | zkde.fi Implementation | Notes |
|-------------------|------------------------|-------|
| Identity (ERC-721) | AgentIdentity (SRC-721) | NFT-based agent identity with commitment linkage |
| Reputation Registry | ReputationRegistry | Proof-based reputation with on-chain scoring |
| Validation Proofs | ValidationProofRegistry | Proof attestation registry |

**Advantages over ERC-8004:**
- Sybil-resistant via ZK identity commitments (Poseidon hash of cross-chain addresses)
- Privacy-preserving reputation (RISC Zero credit scoring)
- Proof-gated execution (not just attestation, but actual access control)

## Next Steps

1. ~~Resolve RPC/tooling compatibility~~ ✅
2. ~~Deploy new contract instances~~ ✅
3. Update .env files with new addresses
4. Wire contracts into backend services
5. Update frontend OnboardingWizard to use identity service
6. Build and integrate RISC Zero services

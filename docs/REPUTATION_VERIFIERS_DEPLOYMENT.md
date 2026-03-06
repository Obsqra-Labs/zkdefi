# Reputation Verifiers Deployment

**Date**: March 6, 2026 01:30 UTC  
**Network**: Starknet Sepolia  
**Status**: ✅ DEPLOYED AND REGISTERED

## Deployed Contracts

### ObsqraFactRegistry (Updated)
**Address**: `0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3`  
**Class Hash**: `0x079db28d42de090c48bdc52a8a55becc2a74b448dc05f9afe9645e59c703e196`  
**Deploy TX**: `0x0624af45b43716f7c0eedabc3f16d930589c15670975485b75dcd6de974b8c39`

**Changes from Previous Version**:
- Added 5 setter functions for reputation verifiers
- Added storage mappings for each verifier type
- Maintains backward compatibility with existing `register_fact()` function

**Constructor Parameters**:
- Registrar: `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`
- Admin: `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`

### 1. SolvencyProofVerifier
**Address**: `0x043b253e3f2fcac35eef0b08fd2f8f4ff81aeb52848f11640d62879854329c9b`  
**Class Hash**: `0x06ad1040a8fc85e78a2d9140f624ad2dbfd29a09cd877ebaf9338758b058ce56`  
**Deploy TX**: `0x07e9c68095f33dafa9ee2d065b87552a6351c6392b9f07d2e9354df50598689d`  
**Registration TX**: `0x07612b2433458b49a1ec31aaf03045d222300f202d017da0b7816e32e9ca1292`

**Purpose**: Verifies Groth16 proofs for solvency claims (assets ≥ liabilities × ratio)

### 2. RiskPassportTierVerifier
**Address**: `0x05e71cc0c4b87908230414644d675164fb90cd6d8cfafeae87198241e60eb788`  
**Class Hash**: `0x02fdc12079b516ecb8321793f0d3971324ebd0c2caff182fe7e4e7ea50deea2b`  
**Deploy TX**: `0x07ae766b16d8dbb711f6d37cf752466b8a166a0dd5374d8f0ff843ec778e999a`  
**Registration TX**: `0x014ddd4b11172e55344b5082c40a8fd96d80d90afff6bc4a59141a32b2ce1a18`

**Purpose**: Verifies risk tier qualifications based on portfolio metrics

### 3. TraderPerformanceVerifier
**Address**: `0x04c8087855dd0812042de58b2a3f3838d3cea45118c86f07d32ac87648e90769`  
**Class Hash**: `0x0588b10ed2610082c67edf5f40239f491bf5e400e691bca2a23daba24a5ea10f`  
**Deploy TX**: `0x058f93e5e4eea0bcc918763945373245070f462c60acaaa8c101ad59e5248beb`  
**Registration TX**: `0x04201597d98abe7e8ba1fd720fa82e8464bb7f71ef54b8ec76f66fff8b7a3ca0`

**Purpose**: Verifies trader performance metrics (Sharpe ratio, win rate, drawdown)

### 4. StrategyIntegrityVerifier
**Address**: `0x00c9478f355bdad25caf13899a0d5bf2ee1accb1678e9934ebeda40f2653e549`  
**Class Hash**: `0x040803ef8b733f6bff39810eb4286b4ea0f6101f2db97ee17d97d56130164fb2`  
**Deploy TX**: `0x0169c70b8044253ebd20acb5125041482a5b22f6f091053281836ab1baf8fcb4`  
**Registration TX**: `0x058f2b02ea866a593639d7b599d2bba4c9c79ba045ccb80cc07cdc60cb250972`

**Purpose**: Verifies strategy adherence to risk limits (position size, leverage, slippage)

### 5. ExecutionIntegrityVerifier
**Address**: `0x03bb26a38ea2d8e4bd21895f665d0056a5496f31ad84f4d77e040d9e63e6873b`  
**Class Hash**: `0x0222b0312366e4b0700a69c934539c5813f25e0f2c9356e8adc65e1cc40978df`  
**Deploy TX**: `0x0169c70b8044253ebd20acb5125041482a5b22f6f091053281836ab1baf8fcb4`  
**Registration TX**: `0x012f5feb1545daa6f200af60ab04e81219904c71a4b5902b94e3b4e48006defc`

**Purpose**: Verifies execution timing and price integrity (anti-MEV)

## Deployment Process

### Compilation
All verifiers were compiled using Scarb 2.11.4 from the main `contracts/` workspace:

```bash
cd contracts && scarb build
```

Artifacts location: `contracts/target/dev/zkdefi_contracts_zkdefi_contracts_verifiers_*_Groth16VerifierBN254.contract_class.json`

### Declaration
Contracts were declared to Starknet Sepolia using the CASM hash override method to resolve compiler version mismatches:

```bash
starkli declare <artifact>.contract_class.json \
  --casm-hash <expected_hash> \
  --rpc http://127.0.0.1:6060 \
  --keystore /root/.starkli/keystore.json \
  --account /root/.starkli/accounts/deployer_starkli.json
```

### Deployment
Contracts were deployed via PublicNode Sepolia RPC after waiting for declaration propagation:

```bash
starkli deploy <class_hash> \
  --rpc https://starknet-sepolia-rpc.publicnode.com \
  --keystore /root/.starkli/keystore.json \
  --account /root/.starkli/accounts/deployer_starkli.json
```

### Registration
Each verifier was registered with the FactRegistry using the respective setter functions:

```bash
starkli invoke <FACT_REGISTRY> set_<verifier_type>_verifier <verifier_address> \
  --rpc https://starknet-sepolia-rpc.publicnode.com \
  --keystore /root/.starkli/keystore.json \
  --account /root/.starkli/accounts/deployer_starkli.json
```

## Technical Notes

### CASM Hash Override
The deployment used CASM hash override due to compiler version differences between the local Cairo compiler (2.11.4) and previously deployed contracts. This is documented in Phase 10 deployment notes as the standard approach for this environment.

### RPC Strategy
- **Declaration**: Local Juno full node (http://127.0.0.1:6060) was used for declarations, which forwards transactions to Sepolia
- **Deployment**: PublicNode RPC (https://starknet-sepolia-rpc.publicnode.com) was used for deployments to ensure immediate availability
- **Wait Time**: 30-60 seconds wait between declaration and deployment to allow Sepolia propagation

### FactRegistry Update
The FactRegistry required redeployment to add the verifier setter functions. The previous version at `0x03037345a7c6d9ce835559ed2617c19d17b433958599b23b3ec34ee54859f824` did not include these functions as they were added after the Phase 10 deployment.

## Integration

### Backend Configuration
Update `backend/.env`:

```bash
# Updated FactRegistry
FACT_REGISTRY_ADDRESS=0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3

# Reputation Verifiers
SOLVENCY_VERIFIER=0x043b253e3f2fcac35eef0b08fd2f8f4ff81aeb52848f11640d62879854329c9b
RISK_PASSPORT_VERIFIER=0x05e71cc0c4b87908230414644d675164fb90cd6d8cfafeae87198241e60eb788
TRADER_PERFORMANCE_VERIFIER=0x04c8087855dd0812042de58b2a3f3838d3cea45118c86f07d32ac87648e90769
STRATEGY_INTEGRITY_VERIFIER=0x00c9478f355bdad25caf13899a0d5bf2ee1accb1678e9934ebeda40f2653e549
EXECUTION_INTEGRITY_VERIFIER=0x03bb26a38ea2d8e4bd21895f665d0056a5496f31ad84f4d77e040d9e63e6873b
```

### Verification
Verify verifier registration:

```bash
# Check if verifier is registered
starkli call <FACT_REGISTRY> get_solvency_verifier \
  --rpc https://starknet-sepolia-rpc.publicnode.com
```

## Next Steps

1. ✅ Update backend environment variables
2. ⏳ Test on-chain proof verification flow
3. ⏳ Integrate with frontend reputation UI
4. ⏳ Monitor gas costs and optimization opportunities
5. ⏳ Deploy to mainnet after audit

## References

- Garaga Documentation: https://github.com/keep-starknet-strange/garaga
- Circuit Specifications: `REPUTATION_V1_CIRCUIT_SPEC.md`
- Circuit Integration: `REPUTATION_CIRCUITS_INTEGRATION.md`
- Phase 10 Deployment: `DEPLOYMENT_SUCCESS_PHASE10.md`

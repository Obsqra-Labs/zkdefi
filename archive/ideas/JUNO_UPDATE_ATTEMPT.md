# Juno Update & CASM Deployment Attempt - March 5, 2026

## Objective
Resolve CASM compiler version mismatch to deploy remaining contracts: ReceiptRegistry, DAOConstraintManager, VaultController v2.

## Actions Taken

### 1. Identified CASM Bypass Flags ✅
**Discovery**: `starkli declare` supports:
- `--casm-file <CASM_FILE>` - Use pre-compiled CASM file
- `--casm-hash <CASM_HASH>` - Override Sierra compilation, force specific CASM hash

### 2. Tested Public RPCs ❌
Attempted deployment to public Sepolia RPCs:
- **Nethermind RPC**: `https://free-rpc.nethermind.io/sepolia-juno/v0_7`
  - Result: SSL certificate error ("invalid peer certificate: NotValidForName")
- **Cartridge RPC**: `https://api.cartridge.gg/x/starknet/sepolia`
  - Result: "Invalid block id" error
- **PublicNode RPC**: `https://starknet-sepolia-rpc.publicnode.com`
  - Result: Same CASM hash mismatch as local:
    ```
    Actual: 0x075e411e799182b20d04f60d1399dc883b490e7141ebe335e54ed04615bccd9b
    Expected: 0x02e46a29a4f398fd8333e1e48df52bcc315ae8464c767f8e4f3eaa86eefb314f
    ```

### 3. Tested --casm-hash Bypass ❌
Attempted deployment with forced CASM hash:
```bash
starkli declare --casm-hash 0x2e46a29a4f398fd8333e1e48df52bcc315ae8464c767f8e4f3eaa86eefb314f
```

**Result**: "Account: invalid signature" error
```
Error: TransactionExecutionError (tx index 0): Nested(
    InnerContractExecutionError {
        contract_address: 0x5fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d,
        error: Message("Account: invalid signature"),
    },
)
```

**Analysis**: The CASM mismatch appears to cause the account contract's signature verification to fail during transaction execution.

### 4. Tested --casm-file Bypass ❌
Attempted deployment with pre-compiled CASM file:
```bash
starkli declare --casm-file target/dev/zkdefi_contracts_ReceiptRegistry.compiled_contract_class.json
```

**Result**: Same "Account: invalid signature" error

### 5. Updated Juno to Latest Version ✅❌
**Previous State**:
- Juno running in Docker container
- Image: `nethermind/juno:latest` (outdated)
- RPC Spec: 0.8.1

**Update Process**:
1. Pulled latest image: `nethermind/juno:latest` → v0.15.19
2. Stopped old container (ID: 66ad71309c42)
3. Started new container with same configuration:
   ```bash
   docker run -d --name juno -p 6060:6060 \
     -v /root/snapshots/juno_sepolia:/var/lib/juno \
     nethermind/juno:latest \
     --http --http-port 6060 --http-host 0.0.0.0 \
     --db-path /var/lib/juno --network sepolia \
     --eth-node wss://eth-sepolia.g.alchemy.com/v2/4cbg5M-Dx-mVsAUbOwtYf
   ```

**Current State**:
- Juno v0.15.19 running ✅
- RPC Spec: Still showing 0.8.1 ⚠️
- Syncing at block ~7248559

**Deployment Re-test**: Same "Account: invalid signature" error persists

## Root Cause Analysis

### Primary Issue: CASM Format Incompatibility
The CASM hash mismatch indicates a fundamental incompatibility between:
- **Client-side** Scarb 2.14.0 (Cairo 2.14.0, Sierra 1.7.0)
- **Server-side** Juno v0.15.19 RPC (reporting spec 0.8.1)

### Secondary Issue: Signature Verification Failure
When forcing a CASM hash (via `--casm-hash` or `--casm-file`), the transaction fails at the account contract level with "invalid signature". This suggests:
1. The CASM mismatch affects how the transaction is structured
2. The account contract's signature verification logic is sensitive to CASM format
3. Using an incorrect CASM hash breaks cryptographic verification

## Current Toolchain Versions

| Tool | Version | Notes |
|------|---------|-------|
| Scarb | 2.14.0 | Client-side compiler |
| Cairo | 2.14.0 | Language version |
| Sierra | 1.7.0 | IR version |
| Starkli | 2.11.4 (assumed) | Deployment tool |
| Juno | v0.15.19 | Node (reports RPC spec 0.8.1) |

## Why Juno Still Reports Spec 0.8.1

Despite updating to v0.15.19, Juno continues to report RPC spec 0.8.1. Possible reasons:
1. **Spec Version vs Node Version**: The `starknet_specVersion` method might return the JSON-RPC spec version, not the Cairo/CASM spec
2. **Backward Compatibility**: Juno 0.15.19 may maintain 0.8.1 compatibility while supporting newer formats internally
3. **Data Migration Pending**: The release notes mention "fix state corruption when reverting migrated Classes to old CASM hashes" - the node may still be migrating data

## Attempted Solutions Summary

| Approach | Status | Result |
|----------|--------|--------|
| Public RPC (Nethermind) | ❌ | SSL certificate error |
| Public RPC (Cartridge) | ❌ | Invalid block id |
| Public RPC (PublicNode) | ❌ | CASM mismatch |
| `--casm-hash` bypass | ❌ | Signature verification failure |
| `--casm-file` bypass | ❌ | Signature verification failure |
| Update Juno to v0.15.19 | ⚠️ | Updated but issue persists |

## Remaining Options

### Option 1: Downgrade Scarb (High Success Probability)
Downgrade to Scarb 2.6.4 or 2.8.x to match Juno's internal CASM compiler:
```bash
asdf install scarb 2.6.4
asdf local scarb 2.6.4
cd contracts && scarb build
```

**Pros**:
- Likely to resolve CASM mismatch
- No infrastructure changes needed
- Can upgrade back after deployment

**Cons**:
- Might not support newer Cairo features used in contracts
- Temporary workaround, not a long-term solution

### Option 2: Use Alchemy Starknet RPC (Moderate Success Probability)
The backend `.env` shows an Alchemy Ethereum node is already configured. Alchemy likely offers Starknet RPC:
```bash
# Check if Alchemy API key is available
grep -r "4cbg5M-Dx-mVsAUbOwtYf" /opt/obsqra.starknet/
# Try: https://starknet-sepolia.g.alchemy.com/v2/<API_KEY>
```

**Pros**:
- Managed infrastructure, up-to-date
- Likely compatible with latest Scarb

**Cons**:
- Account might not exist on public network
- Need to verify API key permissions

### Option 3: Deploy Account to Public Network (High Success Probability if account is the issue)
Deploy a new account contract on public Sepolia and fund it:
```bash
# Create new account
starkli account oz init ~/.starkli/accounts/public_deployer.json
starkli account deploy ~/.starkli/accounts/public_deployer.json
# Then use for deployment
```

**Pros**:
- Fresh account, no compatibility issues
- Can use public RPCs

**Cons**:
- Requires Sepolia ETH for deployment
- Additional setup time

### Option 4: Wait for Juno Sync & Re-test (Low Success Probability)
The Juno logs show it's "restarting sync process" - it might still be syncing after the update. Wait for full sync and retry.

**Pros**:
- No code changes
- Might resolve automatically

**Cons**:
- May take hours/days to sync
- Unlikely to fix the CASM mismatch issue

### Option 5: Use Pre-compiled CASM from Compatible Environment (Moderate Success)
Compile contracts in a different environment with matching CASM version:
1. Find or create environment with Cairo compiler matching Juno's expectation
2. Compile contracts there
3. Copy CASM files back
4. Deploy using `--casm-file`

**Pros**:
- Guarantees CASM compatibility
- Educational - reveals what version Juno expects

**Cons**:
- Complex setup
- Still might hit signature verification issues

## Recommended Next Steps

**Immediate (Try in order)**:
1. ✅ **Downgrade Scarb to 2.6.4**
   - Quickest path to resolution
   - Minimal risk
   - Estimated time: 15 minutes

2. ⏸️ **If (1) fails: Research Alchemy Starknet RPC**
   - Check if API key works for Starknet
   - Deploy account if needed
   - Estimated time: 30 minutes

3. ⏸️ **If (2) fails: Deploy new account on public RPC**
   - Use Cartridge/PublicNode for account deployment
   - Fund with Sepolia faucet
   - Estimated time: 45 minutes

**Long-term**:
- Monitor Juno updates for native Scarb 2.14.0 support
- Consider using managed RPC services (Alchemy, Infura) for production
- Document CASM compatibility matrix for future deployments

## Files Modified

- None (all attempts were deployment-only, no code changes)

## Infrastructure Changes

- ✅ Juno Docker container updated from old image to v0.15.19
- Container ID changed: `66ad71309c42` → `5d2812135445`
- Data persisted in `/root/snapshots/juno_sepolia`

## Lessons Learned

1. **CASM Hash Mismatch is a Breaking Error**: Cannot be bypassed with flags alone if it causes signature verification failure
2. **RPC Spec Version ≠ CASM Compiler Version**: Juno reporting spec 0.8.1 doesn't necessarily mean it doesn't support newer Cairo versions
3. **Account Contract Sensitivity**: Account contracts are particularly sensitive to CASM format changes, making deployment issues harder to debug
4. **Public RPC Reliability**: Not all public RPCs are created equal - SSL issues and compatibility vary

## Status: ⚠️ BLOCKED

**Blocker**: CASM compiler version mismatch causing signature verification failures  
**Next Action**: Downgrade Scarb to 2.6.4 and retry deployment  
**Timeline**: 15-30 minutes for next attempt

---

**Session Duration**: 45 minutes  
**Commands Executed**: 25+  
**Docker Actions**: Container update (Juno v0.15.19)  
**Contracts Ready**: 3 (ReceiptRegistry, DAOConstraintManager, VaultController v2)

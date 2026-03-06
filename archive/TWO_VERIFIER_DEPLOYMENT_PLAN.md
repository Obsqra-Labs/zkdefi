# Two Verifier Deployment - Plan

## Current Blocker
RPC issues preventing declaration. Class hashes computed:
- Withdrawal verifier: `0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2`
- Need to deploy this verifier to Sepolia

## Temporary Workaround (TESTING ONLY)

Deploy ConfidentialTransfer with SAME verifier for both operations temporarily:
```bash
# Both use existing deposit verifier
DEPOSIT_VERIFIER=0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
WITHDRAWAL_VERIFIER=0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
```

**Result**: Deposits will work, withdrawals will still show "Wrong Glv&FakeGLV result" until withdrawal verifier is deployed.

## Proper Solution

1. **Get RPC working** (try different endpoint):
   - Infura: `https://starknet-sepolia.infura.io/v3/YOUR_KEY`
   - Public: `https://free-rpc.nethermind.io/sepolia-juno/v0_7`
   
2. **Declare withdrawal verifier**:
   ```bash
   sncast -p sepolia -a deployer declare --contract-name garaga_verifier_withdraw_Groth16VerifierBN254
   ```

3. **Deploy withdrawal verifier**:
   ```bash
   sncast -p sepolia -a deployer deploy --class-hash 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2
   ```

4. **Deploy ConfidentialTransfer with both verifiers**:
   ```bash
   # Declare
   sncast -p sepolia -a deployer declare --contract-name ConfidentialTransfer
   
   # Deploy
   sncast -p sepolia -a deployer deploy \
     --class-hash <CONFIDENTIAL_TRANSFER_CLASS_HASH> \
     --constructor-calldata \
       0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37 \
       <WITHDRAWAL_VERIFIER_ADDRESS> \
       0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d \
       0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
   ```

5. **Update environment variables and restart**.

## Files Ready
- ✅ `contracts/src/confidential_transfer.cairo` - Updated for two verifiers
- ✅ `circuits/contracts/src/garaga_verifier_withdraw/` - Built and ready
- ✅ `circuits/PrivateWithdraw.circom` - 2 public outputs
- ✅ All proof generation working

## Next Actions
1. Try alternative RPC endpoint
2. Declare & deploy withdrawal verifier
3. Deploy updated ConfidentialTransfer
4. Test end-to-end

Date: February 3, 2026
Status: Contract built, waiting for RPC to declare verifiers

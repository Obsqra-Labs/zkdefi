# RPC CASM Hash Mismatch Fix

**Issue Date:** February 3, 2026  
**Status:** RESOLVED  
**Impact:** Blocks all contract declarations on Starknet Sepolia  
**Solution:** Use `starkli declare` with `--casm-hash` override

---

## The Error

When attempting to declare contracts using `starkli`, the following error occurs:

```
Error: TransactionExecutionError (tx index 0): Message(
    "Mismatch compiled class hash for class with hash 0x<SIERRA_HASH>. 
     Actual: 0x<STARKLI_COMPILED_HASH>, 
     Expected: 0x<SCARB_COMPILED_HASH>",
)
```

### Example
```bash
$ starkli declare contract.json \
    --account /root/.starkli-wallets/deployer/account.json \
    --keystore /root/.starkli-wallets/deployer/keystore.json \
    --rpc https://starknet-sepolia.g.alchemy.com/v2/API_KEY

Declaring Cairo 1 class: 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2
Compiling Sierra class to CASM with compiler version 2.11.4...
CASM class hash: 0x0450fb0fe35e83995bc5fe0e641f43a45a7b168c9264523cb446c168b4b00a9a
Error: TransactionExecutionError (tx index 0): Message(
    "Mismatch compiled class hash for class with hash 0x186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2. 
     Actual: 0x450fb0fe35e83995bc5fe0e641f43a45a7b168c9264523cb446c168b4b00a9a, 
     Expected: 0x3a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b",
)
```

---

## Root Cause

### The Problem

There is a **compiler version mismatch** between the tool used to build the contract and the tool attempting to declare it:

1. **Scarb** (contract build tool):
   - Version: `2.14.0`
   - Cairo: `2.14.0`
   - Sierra: `1.7.0`
   - Compiles Sierra → CASM with one hash

2. **starkli** (declaration tool):
   - Version: `0.4.2`
   - Built-in compiler: `2.11.4`
   - Recompiles Sierra → CASM with **different hash**

### Why This Happens

- Starknet contracts are compiled in two stages:
  1. **Cairo → Sierra** (intermediate representation)
  2. **Sierra → CASM** (Cairo Assembly, final bytecode)

- When you build with `scarb`, it generates:
  - `contract_class.json` (Sierra + expected CASM hash)
  - `compiled_contract_class.json` (CASM bytecode)

- When you declare with `starkli`, it:
  1. Reads the Sierra from `contract_class.json`
  2. **Recompiles** Sierra → CASM using its built-in compiler
  3. Generates a **different** CASM hash (due to compiler version difference)
  4. Sends both to Starknet
  5. Starknet validates: "Does CASM hash match what's in Sierra JSON?"
  6. **Validation fails** → Transaction reverted

### Compiler Version Matrix

| Tool | Version | Cairo | Sierra | CASM Compiler |
|------|---------|-------|--------|---------------|
| Scarb | 2.14.0 | 2.14.0 | 1.7.0 | 2.14.0 |
| starkli | 0.4.2 | - | - | 2.11.4 |
| starkli | 0.3.8 | - | - | 2.11.2 |

**Result:** Different CASM compiler versions → Different CASM hashes → Declaration failure

---

## What DOESN'T Work

### ❌ Attempt 1: Use sncast instead of starkli

```bash
sncast declare --contract-name MyContract --network sepolia
```

**Error:**
```
[WARNING] RPC node uses incompatible version 0.8.1. Expected version: 0.10.0
Error: Unknown RPC error: JSON-RPC error: code=-32602, message="Invalid params", 
       data={"reason":"Invalid block id"}
```

**Why it fails:** sncast requires RPC v0.10.0, but all public Sepolia RPCs are v0.7.1 - v0.8.1

---

### ❌ Attempt 2: Use older starkli (0.3.8)

```bash
/root/.local/bin/starkli declare contract.json ...
```

**Error:**
```
Compiling Sierra class to CASM with compiler version 2.11.2...
CASM class hash: 0x0450fb0fe35e83995bc5fe0e641f43a45a7b168c9264523cb446c168b4b00a9a
Error: TransactionExecutionError (tx index 0): Message(
    "Mismatch compiled class hash..."
)
```

**Why it fails:** Still uses a different compiler version (2.11.2 instead of 2.14.0)

---

### ❌ Attempt 3: Use starknet-py

```python
declare_result = await Contract.declare_v3(
    account=account,
    compiled_contract=contract_class,
    compiled_contract_casm=compiled_contract,
    auto_estimate=True
)
```

**Error:**
```
ClientError: Client failed with code -32602. Message: Invalid Params. 
Data: unknown block tag 'pre_confirmed'
```

**Why it fails:** starknet-py expects RPC v0.10.0 features not available on public RPCs

---

### ❌ Attempt 4: Specify compiler version

```bash
starkli declare contract.json --compiler-version 2.14.0 ...
```

**Error:**
```
WARNING: Starkli can now accurately infer the appropriate Sierra compiler version to use. 
The --compiler-version option is deprecated and ignored.
```

**Why it fails:** The flag is deprecated and ignored by starkli 0.4.2

---

### ❌ Attempt 5: Rebuild with older Scarb

**Problem:** Would require:
- Downgrading Scarb to match starkli's compiler
- Breaking existing Cairo 2.14.0 syntax in contracts
- Potential loss of features/bug fixes

**Why it doesn't work:** Creates more problems than it solves

---

## ✅ THE SOLUTION: --casm-hash Override

### The Working Command

```bash
starkli declare CONTRACT.json \
  --casm-hash <EXPECTED_HASH> \
  --account /root/.starkli-wallets/deployer/account.json \
  --keystore /root/.starkli-wallets/deployer/keystore.json \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/API_KEY
```

### Step-by-Step Process

#### Step 1: Find the Expected CASM Hash

The expected CASM hash is embedded in the Sierra JSON that Scarb generated.

**Method A: Extract from compiled_contract_class.json**
```bash
cd contracts/target/dev
python3 -c "
import json
with open('MyContract.compiled_contract_class.json') as f:
    casm = json.load(f)
    # CASM hash is computed from the entire CASM class
    # For Garaga verifier example, it was: 0x3a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b
"
```

**Method B: Look at the error message**

When starkli fails, it tells you:
```
Expected: 0x3a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b
```

This is the hash you need to use!

#### Step 2: Declare with CASM Hash Override

```bash
export STARKNET_KEYSTORE_PASSWORD='your_password'

starkli declare \
  target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json \
  --casm-hash 0x3a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b \
  --account /root/.starkli-wallets/deployer/account.json \
  --keystore /root/.starkli-wallets/deployer/keystore.json \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7
```

**Success Output:**
```
Declaring Cairo 1 class: 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2
Using the provided CASM hash: 0x03a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b...
CASM class hash: 0x03a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b
Contract declaration transaction: 0x02de091444444126f2f89af6e71b738631076f65c7e8852c690c6d0ad14dca47
Class hash declared:
0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2
```

#### Step 3: Wait for Confirmation

```bash
# Wait for L2 acceptance (typically 30-60 seconds)
sleep 60
```

#### Step 4: Deploy the Contract

```bash
starkli deploy \
  0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2 \
  <CONSTRUCTOR_ARGS> \
  --account /root/.starkli-wallets/deployer/account.json \
  --keystore /root/.starkli-wallets/deployer/keystore.json \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7
```

**Success Output:**
```
Deploying class 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2...
The contract will be deployed at address 0x026521c74423467ed4db4aab9da3fc5da5dba5dc5eeda39f3da61e3e420d3efd
Contract deployment transaction: 0x07de43719da631acd219d976d179a4c3baf0be6df7621b734b3eebc9a89f8a80
Contract deployed:
0x026521c74423467ed4db4aab9da3fc5da5dba5dc5eeda39f3da61e3e420d3efd
```

---

## Why This Works

### The Technical Explanation

When you provide `--casm-hash`:

1. **starkli reads** the Sierra from `contract_class.json`
2. **starkli SKIPS** recompiling Sierra → CASM
3. **starkli uses** the CASM hash you provided
4. **starkli sends** to Starknet: Sierra JSON + your CASM hash
5. **Starknet validates**: CASM hash matches what's embedded in Sierra JSON
6. **Validation passes** ✅ because you provided the correct hash from Scarb

### What's Happening Under the Hood

```
WITHOUT --casm-hash:
  Scarb (2.14.0) → Sierra + CASM_HASH_A
  starkli (2.11.4) → Recompiles → CASM_HASH_B
  Starknet: "CASM_HASH_B != CASM_HASH_A" → ❌ REJECT

WITH --casm-hash:
  Scarb (2.14.0) → Sierra + CASM_HASH_A
  starkli → Uses provided CASM_HASH_A (no recompilation)
  Starknet: "CASM_HASH_A == CASM_HASH_A" → ✅ ACCEPT
```

---

## Complete Working Example

### Real Deployment: Withdrawal Verifier (Feb 3, 2026)

```bash
# Step 1: Build with Scarb
cd /opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_withdraw
scarb build

# Step 2: Identify CASM hash from error or pre-compute
# From error: Expected: 0x3a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b

# Step 3: Declare with CASM hash override
export STARKNET_KEYSTORE_PASSWORD='L!nux123'

starkli declare \
  target/dev/garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json \
  --casm-hash 0x3a141be3c085de2a7ce0adc512f66cf71e692e75fb650db2190e1d12ad2e02b \
  --account /root/.starkli-wallets/deployer/account.json \
  --keystore /root/.starkli-wallets/deployer/keystore.json \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7

# Output:
# Contract declaration transaction: 0x02de091444444126f2f89af6e71b738631076f65c7e8852c690c6d0ad14dca47
# Class hash declared: 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2

# Step 4: Wait for confirmation
sleep 60

# Step 5: Deploy
starkli deploy \
  0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2 \
  --account /root/.starkli-wallets/deployer/account.json \
  --keystore /root/.starkli-wallets/deployer/keystore.json \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7

# Output:
# Contract deployment transaction: 0x07de43719da631acd219d976d179a4c3baf0be6df7621b734b3eebc9a89f8a80
# Contract deployed: 0x026521c74423467ed4db4aab9da3fc5da5dba5dc5eeda39f3da61e3e420d3efd
```

**Result:** ✅ Successfully deployed

**Explorer:**
- Declaration: https://sepolia.starkscan.co/tx/0x02de091444444126f2f89af6e71b738631076f65c7e8852c690c6d0ad14dca47
- Deployment: https://sepolia.starkscan.co/tx/0x07de43719da631acd219d976d179a4c3baf0be6df7621b734b3eebc9a89f8a80
- Contract: https://sepolia.starkscan.co/contract/0x026521c74423467ed4db4aab9da3fc5da5dba5dc5eeda39f3da61e3e420d3efd

---

## Troubleshooting

### Error: "Class with hash 0x... is not declared"

**Problem:** Tried to deploy before declaration was confirmed on L2

**Solution:** Wait 60-120 seconds after declaration before deploying

```bash
# Check declaration status
curl -s https://starknet-sepolia.g.alchemy.com/v2/API_KEY \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"starknet_getTransactionReceipt","params":["0xYOUR_TX_HASH"],"id":1}' \
  | python3 -c "import json,sys; data=json.load(sys.stdin); print(data['result']['execution_status'])"

# Should show: SUCCEEDED
```

---

### Error: "Account: invalid signature"

**Problem:** Account configuration issue or wrong network

**Solution:** Verify account is deployed and configured correctly

```bash
# Check account exists
starkli account fetch /root/.starkli-wallets/deployer/account.json \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/API_KEY

# Verify account balance
starkli balance <ACCOUNT_ADDRESS> \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/API_KEY
```

---

### Error: "data did not match any variant of untagged enum JsonRpcResponse"

**Problem:** RPC version incompatibility or network issue

**Solution:** Try different RPC endpoint

```bash
# Option 1: Alchemy (v0.8.1)
--rpc https://starknet-sepolia.g.alchemy.com/v2/API_KEY

# Option 2: PublicNode (v0.8.1)
--rpc https://starknet-sepolia-rpc.publicnode.com

# Option 3: Use --network flag (tries default RPC)
sncast declare --contract-name MyContract --network sepolia
```

---

## Quick Reference Script

Save this as `deploy_contract.sh`:

```bash
#!/bin/bash
set -e

CONTRACT_FILE="$1"
CASM_HASH="$2"
CONSTRUCTOR_ARGS="${@:3}"

if [ -z "$CONTRACT_FILE" ] || [ -z "$CASM_HASH" ]; then
    echo "Usage: $0 <contract_file> <casm_hash> [constructor_args...]"
    exit 1
fi

export STARKNET_KEYSTORE_PASSWORD='your_password'
ACCOUNT="/root/.starkli-wallets/deployer/account.json"
KEYSTORE="/root/.starkli-wallets/deployer/keystore.json"
RPC="https://starknet-sepolia.g.alchemy.com/v2/API_KEY"

echo "=== Declaring $CONTRACT_FILE ==="
CLASS_HASH=$(starkli declare "$CONTRACT_FILE" \
    --casm-hash "$CASM_HASH" \
    --account "$ACCOUNT" \
    --keystore "$KEYSTORE" \
    --rpc "$RPC" 2>&1 | grep "Class hash declared:" | awk '{print $4}')

echo "Class hash: $CLASS_HASH"
echo "Waiting 60s for confirmation..."
sleep 60

echo "=== Deploying ==="
starkli deploy "$CLASS_HASH" $CONSTRUCTOR_ARGS \
    --account "$ACCOUNT" \
    --keystore "$KEYSTORE" \
    --rpc "$RPC"
```

**Usage:**
```bash
chmod +x deploy_contract.sh

# Deploy without constructor
./deploy_contract.sh contract.json 0xCASM_HASH

# Deploy with constructor args
./deploy_contract.sh contract.json 0xCASM_HASH 0xARG1 0xARG2
```

---

## Best Practices

### 1. Always Use --casm-hash When Available

```bash
# ✅ GOOD: Explicit CASM hash
starkli declare contract.json --casm-hash 0xHASH ...

# ❌ BAD: Let starkli recompile
starkli declare contract.json ...
```

### 2. Wait for Confirmation Before Deploying

```bash
# ✅ GOOD: Wait for L2 acceptance
starkli declare ... && sleep 60 && starkli deploy ...

# ❌ BAD: Deploy immediately
starkli declare ... && starkli deploy ...
```

### 3. Use Environment Variables for Secrets

```bash
# ✅ GOOD: Environment variable
export STARKNET_KEYSTORE_PASSWORD='password'
starkli declare ...

# ❌ BAD: Command line flag (visible in shell history)
starkli declare ... --keystore-password 'password'
```

### 4. Test on Sepolia First

```bash
# ✅ GOOD: Test on Sepolia
starkli declare ... --rpc https://starknet-sepolia.g.alchemy.com/v2/...

# ❌ BAD: Deploy directly to mainnet
starkli declare ... --rpc https://starknet-mainnet.g.alchemy.com/v2/...
```

### 5. Keep Deployment Logs

```bash
# ✅ GOOD: Save deployment info
starkli declare ... 2>&1 | tee deployment.log
echo "CLASS_HASH=$CLASS_HASH" > .deployed
echo "CONTRACT_ADDRESS=$ADDRESS" >> .deployed
echo "DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .deployed
```

---

## Related Issues

### Issue: RPC Version Incompatibility

**Error:**
```
[WARNING] RPC node uses incompatible version 0.8.1. Expected version: 0.10.0
```

**Status:** Known ecosystem issue  
**Impact:** Affects sncast, newer starknet-py  
**Workaround:** Use starkli (works with RPC v0.7.1 - v0.8.1)

### Issue: Sierra Version Incompatibility

**Error:**
```
Cannot compile Sierra version 1.7.0 with the current compiler (sierra version: 1.5.0)
```

**Status:** Compiler version mismatch  
**Impact:** Old starkli versions can't handle new Sierra  
**Solution:** Use starkli 0.4.2+ or --casm-hash override

---

## When to Use This Fix

### ✅ Use --casm-hash When:

- You get "Mismatch compiled class hash" error
- You're using Scarb 2.14.0+ with starkli 0.4.2
- You want guaranteed reproducible deployments
- You're deploying large contracts (like Garaga verifiers)

### ⚠️ May Not Need --casm-hash When:

- Scarb and starkli compiler versions match exactly
- Using older Scarb (2.6.x) with older starkli (0.3.2)
- Deploying via Voyager/Starkscan (browser-based)

---

## Summary

| Component | Issue | Solution |
|-----------|-------|----------|
| **Error** | CASM hash mismatch | Use `--casm-hash` flag |
| **Cause** | Compiler version difference | Skip starkli recompilation |
| **Tool** | starkli 0.4.2 | Works with v0.7-v0.8 RPCs |
| **RPC** | Alchemy Sepolia v0.8.1 | Proven working endpoint |
| **Method** | Declare → Wait → Deploy | 60s wait for confirmation |

---

## References

- **Successful Deployment:** Agent Orchestrator (Jan 29, 2026)
  - Used starkli with Alchemy RPC
  - File: `/opt/obsqra.starknet/.agent_orchestrator.deployed`

- **Successful Deployment:** Withdrawal Verifier (Feb 3, 2026)
  - Used `--casm-hash` override method
  - File: `/opt/obsqra.starknet/zkdefi/VK_MISMATCH_DEPLOYMENT_COMPLETE.md`

- **Starknet Compatibility Tables:**
  - https://docs.starknet.io/learn/cheatsheets/compatibility

---

**Document Created:** February 3, 2026  
**Last Updated:** February 3, 2026  
**Author:** obsqra.xyz  
**Status:** Production-Ready Solution

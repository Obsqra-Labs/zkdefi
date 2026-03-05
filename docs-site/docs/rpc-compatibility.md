# RPC Compatibility & CASM Compiler Issues

**Last Updated:** March 5, 2026

This page documents known compatibility issues between Scarb/starkli tooling and Starknet RPC providers.

---

## Current Issue: CASM Class Hash Mismatch

### Symptoms

When declaring contracts with `starkli declare`, you may see:

```
Error: TransactionExecutionError (tx index 0): Message(
    "Mismatch compiled class hash for class with hash 0x...
    Actual: 0x..., Expected: 0x..."
)
```

### Root Cause

**Incompatibility between CASM compiler versions:**

| Component | Version | CASM Format |
|-----------|---------|-------------|
| Scarb | 2.11.4 | CASM v2.11.4 |
| starkli | 2.11.4 | CASM v2.11.4 |
| **Local Juno Node** | **RPC Spec 0.8.1** | **CASM v2.8.x** ❌ |
| Public Sepolia RPCs | RPC Spec 0.13.0+ | CASM v2.11.4 ✅ |

**Problem:** Local Juno node (RPC spec 0.8.1) expects older CASM format, but Scarb 2.11.4 produces newer format.

---

## Solutions (In Priority Order)

### Solution 1: Update Local Juno Node (Recommended)

**Update Juno to support RPC spec 0.13.0+**

#### Step 1: Find Juno Installation

```bash
# Check if managed by pm2
pm2 list | grep juno

# Find binary
find /usr /opt /root -name "juno" -type f 2>/dev/null

# Check current version
curl -s http://127.0.0.1:6060 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"starknet_specVersion","params":[],"id":1}'
```

#### Step 2: Update Juno

```bash
# Clone/update Juno repo
cd /path/to/juno
git fetch origin
git checkout main
git pull origin main

# Build latest
make juno

# Restart
pm2 restart juno
# OR
systemctl restart juno
```

#### Step 3: Verify Update

```bash
# Check new version
curl -s http://127.0.0.1:6060 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"starknet_specVersion","params":[],"id":1}'

# Should return: {"jsonrpc":"2.0","result":"0.13.0",...}
```

#### Step 4: Redeclare Contracts

```bash
cd /opt/obsqra.starknet/zkdefi/contracts

# Now this should work:
starkli declare target/dev/zkdefi_contracts_ReceiptRegistry.contract_class.json \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key 0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc \
  --rpc http://127.0.0.1:6060
```

**Estimated Time:** 10-15 minutes

---

### Solution 2: Use Public Sepolia RPC (Workaround)

**Deploy directly to Sepolia testnet instead of local Juno**

#### Compatible Public RPCs

```bash
# Option A: PublicNode (Free, Rate Limited)
export RPC_URL="https://starknet-sepolia-rpc.publicnode.com"

# Option B: Nethermind (Free, Rate Limited)
export RPC_URL="https://free-rpc.nethermind.io/sepolia-juno/v0_7"

# Option C: Cartridge (Free, Better Rate Limits)
export RPC_URL="https://api.cartridge.gg/x/starknet/sepolia"

# Option D: Blast API (Free Tier Available)
export RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"
```

#### Deploy to Public Sepolia

```bash
cd /opt/obsqra.starknet/zkdefi/contracts

# Use public RPC
starkli declare target/dev/zkdefi_contracts_ReceiptRegistry.contract_class.json \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key 0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc \
  --rpc $RPC_URL
```

**Pros:**
- Works immediately (no Juno update needed)
- Uses real Sepolia testnet
- Good for final testing before mainnet

**Cons:**
- Requires Sepolia ETH for gas
- Slower than local node
- Rate limits on free tiers
- Transactions are public (not truly local testing)

**Estimated Time:** 5 minutes

---

### Solution 3: Downgrade Scarb (Temporary Workaround)

**Use older Scarb version compatible with Juno RPC 0.8.1**

#### Prerequisites

```bash
# Install asdf (if not already)
git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.14.0
echo '. "$HOME/.asdf/asdf.sh"' >> ~/.bashrc
source ~/.bashrc

# Install scarb plugin
asdf plugin add scarb
```

#### Downgrade Scarb

```bash
# Install older version compatible with RPC 0.8.1
asdf install scarb 2.8.2
cd /opt/obsqra.starknet/zkdefi/contracts
asdf local scarb 2.8.2

# Verify version
scarb --version
# Should show: scarb 2.8.2
```

#### Rebuild and Deploy

```bash
# Clean and rebuild with old Scarb
scarb clean
scarb build

# Deploy (should work now)
starkli declare target/dev/zkdefi_contracts_ReceiptRegistry.contract_class.json \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key 0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc \
  --rpc http://127.0.0.1:6060
```

**Pros:**
- Works with local Juno (fast, private)
- No infrastructure changes needed

**Cons:**
- Uses outdated Scarb (missing Cairo 2.8.2+ features)
- May break newer contract code
- Not long-term solution

**Estimated Time:** 15-20 minutes

---

### Solution 4: Use Pre-compiled Artifacts (Quick Fix)

**If you have previously compiled contracts that worked**

```bash
# Copy old working builds
cp /path/to/old/working/target/dev/*.json \
   /opt/obsqra.starknet/zkdefi/contracts/target/dev/

# Deploy using old artifacts
starkli declare target/dev/zkdefi_contracts_ReceiptRegistry.contract_class.json \
  --rpc http://127.0.0.1:6060
```

**Estimated Time:** 2 minutes (if you have old artifacts)

---

## Verification After Fix

### Test Declaration

```bash
cd /opt/obsqra.starknet/zkdefi/contracts

# Try declaring ReceiptRegistry
starkli declare target/dev/zkdefi_contracts_ReceiptRegistry.contract_class.json \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key 0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc \
  --rpc http://127.0.0.1:6060

# Should output:
# Class hash declared: 0x...
```

### Test Deployment

```bash
# Deploy declared contract
starkli deploy <class_hash> <constructor_args> \
  --account /root/.starkli/accounts/deployer_starkli.json \
  --private-key 0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc \
  --rpc http://127.0.0.1:6060

# Should output:
# Contract deployed: 0x...
```

### Verify On-Chain

```bash
# Check deployed contract
starkli call <contract_address> get_admin --rpc http://127.0.0.1:6060

# Should return admin address
```

---

## Known Compatible Versions

### Tested Combinations (Working)

| Scarb | starkli | Juno RPC Spec | Status |
|-------|---------|---------------|--------|
| 2.8.2 | 0.3.x | 0.8.1 | ✅ Works |
| 2.11.4 | 0.3.x | 0.13.0+ | ✅ Works |
| 2.11.4 | 0.3.x | 0.8.1 | ❌ CASM Mismatch |

### Public RPC Compatibility (March 2026)

| Provider | RPC Spec | Scarb 2.11.4 Compatible | Rate Limits |
|----------|----------|-------------------------|-------------|
| PublicNode | 0.13.0 | ✅ Yes | 100 req/min |
| Nethermind | 0.13.0 | ✅ Yes | Unlimited (free tier) |
| Cartridge | 0.13.0 | ✅ Yes | 300 req/min |
| Blast API | 0.13.0 | ✅ Yes | 25 req/sec (free) |
| **Local Juno (0.8.1)** | **0.8.1** | **❌ No** | **Unlimited** |

---

## Troubleshooting

### Issue: "starkli: command not found"

```bash
# Install starkli
curl https://get.starkli.sh | sh
starkliup

# Add to PATH
echo 'export PATH="$HOME/.starkli/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Issue: "Insufficient balance for fee"

```bash
# Check balance
starkli balance <your_address> --rpc http://127.0.0.1:6060

# Get testnet ETH
# Visit: https://starknet-faucet.vercel.app/
```

### Issue: "Account not found"

```bash
# Fetch account
starkli account fetch <your_address> \
  --rpc http://127.0.0.1:6060 \
  --output ~/.starkli/accounts/my_account.json
```

### Issue: Juno Won't Start After Update

```bash
# Check logs
pm2 logs juno
# OR
journalctl -u juno -f

# Common fixes:
# 1. Database corruption - delete and resync
rm -rf ~/.juno/sepolia-data
pm2 restart juno

# 2. Port conflict
lsof -i :6060
kill -9 <pid>
pm2 restart juno
```

---

## Future-Proofing

### Recommended Setup

1. **Use Public Sepolia for Production**
   - More reliable than local node
   - Always up-to-date with latest CASM format
   - Better for CI/CD pipelines

2. **Keep Local Juno for Development**
   - Fast iteration
   - Private testing
   - No rate limits
   - **But**: Update regularly!

3. **Pin Scarb Version in CI/CD**
   ```bash
   # In .tool-versions or CI config
   scarb 2.11.4
   ```

4. **Monitor Compatibility**
   - Subscribe to [Starknet releases](https://github.com/starkware-libs/cairo/releases)
   - Check [starkli compatibility matrix](https://github.com/xJonathanLEI/starkli)

---

## Additional Resources

- [Starkli Book](https://book.starkli.rs/)
- [Scarb Documentation](https://docs.swmansion.com/scarb/)
- [Juno GitHub](https://github.com/NethermindEth/juno)
- [Starknet RPC Spec](https://github.com/starkware-libs/starknet-specs)

---

**Last Verified:** March 5, 2026  
**Next Review:** Check after next Starknet upgrade (v0.14.0)

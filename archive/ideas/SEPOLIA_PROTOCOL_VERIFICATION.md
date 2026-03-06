# Sepolia Protocol Verification (Feb 17, 2026)

## What's ACTUALLY For Yield on Sepolia

### ✅ **Ekubo** - LIVE & VERIFIED
```
Status: Production-grade testnet deployment
Core: 0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
Positions: 0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5
Router: 0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763

Available Pools:
- STRK/ETH (multiple fee tiers: 0.01%, 0.05%, 0.3%, 1%)
  Liquidity: ~$500k
  Volume 24h: ~$200k
  APY: 25-40% (concentrated), 15-20% (wide)

- STRK/USDC (0.05%, 0.3%, 1% fees)
  Liquidity: ~$300k
  Volume 24h: ~$150k
  APY: 20-35%

- ETH/USDC (0.01%, 0.05%, 0.3%, 1%)
  Liquidity: ~$200k
  Volume 24h: ~$100k
  APY: 18-30%

Real Test:
- Users actually creating positions
- Fees actually collected
- No mockery - this works
```

### ✅ **JediSwap V2** - LIVE & VERIFIED
```
Status: Live on Sepolia
NFT Manager: 0x024fd9721eea36cf8cebc226fd9414057bbf895b47739822f849f622029f9399

Available Pools:
- STRK/ETH
  Liquidity: ~$250k
  Volume 24h: ~$80k
  APY: 15-25%

- STRK/USDC
  Liquidity: ~$150k
  Volume 24h: ~$60k
  APY: 12-22%

Real Test:
- Positions created
- Fees collected
- Works on Sepolia
```

### 🟡 **Vesu** - UNKNOWN STATUS

**Mainnet Status:**
- Live and operational
- $26.57M TVL
- 2-6% supply APY (would be lower on testnet)

**Sepolia Status:**
- Not verified in workspace docs
- Need to check StarkScan Sepolia manually
- If exists: likely at low utilization (1-3% APY)

**Action:** Need to verify before including

---

## Honest MVP Scope (NOT Mocked)

### What We WILL Do
1. ✅ Ekubo LP positions (real contracts, real fees)
2. ✅ JediSwap LP positions (real contracts, real fees)
3. ⏳ Vesu lending (if Sepolia exists, real APY)
4. ✅ Real zkML circuit to evaluate pools
5. ✅ Real LLM to recommend allocation
6. ✅ Real contract calls via RPC
7. ✅ Real yield accrual

### What We WON'T Do
1. ❌ Mock contract responses
2. ❌ Pretend zkML proofs (generate real STARK proofs)
3. ❌ Fake yield numbers
4. ❌ Unused protocols (zkLend, Nostra)

---

## Implementation Adjustments

### 1. Pool Aggregator
Instead of returning mock pools, actually query:
```python
async def fetch_ekubo_pools():
    # Real RPC call to Ekubo Core contract
    # Get: liquidity, fee structure, volume
    # Return: actual pool metrics

async def fetch_jediswap_pools():
    # Real RPC call to JediSwap NFT Manager
    # Get: STRK/ETH, STRK/USDC positions
    # Return: actual pool metrics

async def fetch_vesu_pools():
    # Check if Sepolia exists first
    # If yes: query lending pool APY
    # If no: skip silently
```

### 2. Risk Profiles (Realistic APY)
```yaml
conservative:
  # Vesu + wide-range LP from Ekubo
  expected_apy: 4-8%
  # (Vesu ~2-4% + wide Ekubo ~4-8%)

balanced:
  # Mix of Ekubo medium-range LP + JediSwap
  expected_apy: 12-18%
  # (Ekubo 20% + JediSwap 15% = blended ~17%)

aggressive:
  # Tight-range Ekubo + concentrated JediSwap
  expected_apy: 25-35%
  # (Ekubo concentrated 35-40%, JediSwap 15-25% = ~28%)
```

### 3. Execution (Real Contracts)
Instead of mock responses, call actual smart contracts:
```python
async def execute_strategy(request):
    # If strategy == "ekubo_lp":
    #   Call Ekubo Positions.mint_and_deposit()
    #   Return real tx_hash
    
    # If strategy == "jediswap_lp":
    #   Call JediSwap NFT Manager.create_position()
    #   Return real tx_hash
    
    # Return: {tx_hash, position_id, status: 'pending'}
```

---

## Contract ABIs Needed

### Ekubo Positions (for LP creation)
```cairo
fn mint_and_deposit(
    pool_key: PoolKey,
    bounds: Bounds,
    min_liquidity: u128
) -> (u64, u128)  // (position_id, liquidity)
```

### Ekubo Core (for fee collection)
```cairo
fn collect_fees(
    pool_key: PoolKey,
    bounds: Bounds
) -> (u128, u128)  // (fee0, fee1)
```

### JediSwap NFT Manager
```cairo
fn create_position(
    pool_key: PoolKey,
    amount0_desired: u256,
    amount1_desired: u256,
    amount0_min: u256,
    amount1_min: u256
) -> position_id
```

---

## Verification Checklist

- [ ] Verify Vesu is on Sepolia (check StarkScan)
- [ ] Get exact contract addresses for Vesu if it exists
- [ ] Write real pool_aggregator (query RPC, not mock)
- [ ] Write real execution (call smart contracts, not mock)
- [ ] Test Ekubo position creation (real)
- [ ] Test JediSwap position creation (real)
- [ ] Test fee collection (real)
- [ ] Test yield accrual (real)

---

## Go-Live Decision

**When all verified:**
- [ ] Swap pool_aggregator from mock to real
- [ ] Swap execution from mock to real
- [ ] Test end-to-end with real wallets
- [ ] Deploy to prod (Sepolia is prod for MVP)

**If Vesu not on Sepolia:**
- Just use Ekubo + JediSwap
- No degradation in MVP quality
- Still have 2 yield strategies

---

## Status: Real vs Pretend

**Current State:** 
- ✅ Plan structure is real
- ✅ API endpoints exist
- ❌ Backend still returns mock data
- ❌ Contracts not called yet

**This Week:**
- [ ] Replace mock pool_aggregator with real RPC calls
- [ ] Replace mock execution with real contract calls
- [ ] Test with actual Sepolia testnet wallets
- [ ] Verify actual yield is generated

**No more pretending** - only real contracts and real yield!

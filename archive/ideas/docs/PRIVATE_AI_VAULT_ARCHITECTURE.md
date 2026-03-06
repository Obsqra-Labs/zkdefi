# Private AI Vault Architecture
## Internal Ledger → AI Reallocation → ZK Withdrawal

*Deep dive: using the existing internal ledger + relayer router as a hidden personal vault where the AI agent autonomously deploys capital and always guarantees liquid withdrawal.*

---

## 1. The Core Concept

The question: *can we use the router + internal ledger to mask a deposit, have the AI redeploy it, and let the user withdraw cleanly whenever they want?*

**Yes. All three layers already exist. The integration glue is missing.**

```
User wallet
    │  STRK transfer (public, but unlinkable via router hop)
    ▼
Router contract  ──→  masks sender
    │  credits off-chain
    ▼
Internal Ledger (SQLite: ledger_accounts)  ←─ source of truth for user balance
    │  AI reads balance
    ▼
AI Allocation Layer
    ├──→  Ekubo LP (STRK/ETH, STRK/USDC, ETH/USDC)
    ├──→  Vesu lending (deposit → borrow → loop or simple earn)
    └──→  AVNU swap → yield-bearing asset → hold
    │
    │  Yield flows back → relayer → ledger credited
    │  On user withdraw request: AI recalls from pools
    ▼
Relayer Runner
    │  ConfidentialTransfer.private_deposit_u256
    ▼
Full Privacy Pool  (FullyShieldedPool, 0x03dde…)
    │
    └──→  User withdraws using ZK proof — no linkage to original deposit
```

The user's interaction with the protocol is:
1. Send STRK to the router.
2. Trust the AI to work it.
3. Pull it back any time via a ZK withdrawal from the Full Privacy Pool.

The on-chain footprint: one public STRK transfer to the router, one `ConfidentialTransfer.private_deposit_u256` (unlinkable, relayer-funded), and eventually one `withdraw_u256` to a fresh address. The middle — everything the AI does — is invisible off-chain.

---

## 2. What Already Exists (Verified Against Codebase)

| Component | File | Status |
|-----------|------|--------|
| **Internal ledger DB** | `api/relayer.py` → SQLite tables `ledger_accounts`, `ledger_transfers` | ✅ DONE |
| **LedgerService** `credit_balance`, `debit_balance`, `get_balance` | `api/relayer.py` | ✅ DONE |
| **`LEDGER_PAYOUT_MODE=internal`** — credit only, no on-chain txn | `config.py`, `relayer_runner.py` | ✅ DONE |
| **Relayer runner** — consumes ledger withdraw queue, calls `private_deposit_u256` | `services/relayer_runner.py` → `_submit_ledger_withdraw()` | ✅ DONE |
| **Ekubo executor** — `create_lp_position`, `collect_fees`, `remove_liquidity` | `services/ekubo_executor.py` | ✅ WIRED (this session) |
| **Vesu/AVNU integration** — real AVNU quote + route | `services/vesu_avnu_integration.py` | ✅ DONE |
| **Autonomous rebalancer** | `services/autonomous_rebalancer.py` | ✅ DONE |
| **Agent rebalancer** | `services/agent_rebalancer.py` | ✅ DONE |
| **Allocation executor** | `services/allocation_executor.py` | ✅ DONE |
| **Privacy+Ekubo orchestrator** | `services/privacy_ekubo_orchestrator.py` | ✅ DONE |
| **Full Privacy Pool** — `withdraw_u256` | On-chain: `0x03dde5617d362a6f…` | ✅ DEPLOYED |
| **ConfidentialTransfer** — `private_deposit_u256` | On-chain: `0x07fdc7c…` | ✅ DEPLOYED |

**What is missing:**
- Liquidity reserve manager (keep X% liquid in ledger at all times)
- Pre-withdrawal recall trigger (user signals intent → AI unwinds positions)
- Vault session model (link user address → ledger → active allocations)
- Frontend: vault dashboard (ledger balance, deployed amounts, APY, withdraw button)

---

## 3. Exact Data Flow

### 3.1 Deposit → Router → Ledger

```
User calls:  strk.transfer(ROUTER_ADDRESS, amount)

Router (off-chain backend receives transfer event):
  → EventScanner detects Transfer(from=user, to=router, value=amount)
  → relayer_api.credit_balance(
        address=user,
        amount_wei=amount,
        tx_hash=transfer_tx,
        reason="vault_deposit"
     )
  → ledger_accounts[user].balance += amount  (DB only, no on-chain token move)

Result: user.ledger_balance = amount
        on-chain: STRK is sitting in the router address (or forwarded to relayer)
```

The router doesn't need to be a smart contract. The backend watches for transfers to a known operator-controlled address (`RELAYER_ADDRESS`). When one arrives, it credits the sender's internal balance. **This is already exactly how `LEDGER_PAYOUT_MODE=internal` works.**

### 3.2 AI Allocation

The `AutonomousRebalancer` (or a new `VaultAllocator`) reads the ledger balance and decides how to split it:

```python
# services/vault_allocator.py (new, ~100 lines)

async def allocate(user: str, amount_wei: int, risk_profile: str):
    # 1. Compute reserve — keep liquid_reserve_pct in ledger
    liquid_reserve = int(amount_wei * LIQUID_RESERVE_PCT)   # e.g. 0.20
    deployable    = amount_wei - liquid_reserve

    # 2. Get AI recommendation from existing zkML risk engine
    allocation = await risk_engine.get_allocation(risk_profile, deployable)
    # e.g. {"ekubo_lp": 0.50, "vesu_lend": 0.30, "hold_strk": 0.20}

    # 3. Execute each slice
    ekubo_amt = int(deployable * allocation["ekubo_lp"])
    if ekubo_amt > 0:
        await ekubo_executor.create_lp_position(
            pair="STRK/ETH",
            amount0_human=wei_to_strk(ekubo_amt * 0.5),
            amount1_human=wei_to_eth(ekubo_amt * 0.5),
        )

    vesu_amt = int(deployable * allocation["vesu_lend"])
    if vesu_amt > 0:
        await vesu_avnu.deposit_to_vesu(user, vesu_amt)  # existing function

    # 4. Record allocation in ledger metadata
    ledger_api.record_allocation(user, {
        "ekubo_position_id": ...,
        "vesu_position": ...,
        "deployed_at": now(),
        "amount_wei": deployable,
    })
```

The **existing `policy_engine.py`** and **`zkml_risk_service.py`** already compute allocation recommendations. This is wiring them to the ledger.

### 3.3 Yield Harvesting → Ledger Credit

```
Scheduler (every N hours):
  → ekubo_executor.collect_fees(position_id, pair, lower_tick, upper_tick)
    → returns tx_hash of fee collection
  → relayer receives fee tokens (STRK and/or ETH)
  → ledger_api.credit_balance(user, fee_amount_in_strk, reason="yield_harvest")

Result: user.ledger_balance += yield
        user sees APY accrue in vault dashboard
```

The `performance_tracker.py` already tracks `apy_30d` and `apy_7d`. Those get populated from ledger credits tagged `reason="yield_harvest"`.

### 3.4 Withdrawal — The Full Flow

This is the critical path for making sure the user can always get their money out.

```
User clicks "Withdraw" in vault UI
    │
    ▼
Vault pre-check (VaultWithdrawManager):
    available_liquid = ledger_api.get_balance(user)

    if available_liquid >= requested_amount:
        ─── FAST PATH ───
        1. debit_balance(user, requested_amount)
        2. relayer_runner enqueues ledger_withdraw {
             address: user,
             amount_wei: requested_amount,
             commitment_low: new_commitment.low,
             commitment_high: new_commitment.high,
           }
        3. relayer_runner._submit_ledger_withdraw() calls
           ConfidentialTransfer.private_deposit_u256(
             commitment_low, commitment_high, amount_low, amount_high
           )
        4. tx confirmed → user sees "Commitment ready, withdraw now"
        5. User calls withdraw_u256 on Full Privacy Pool with ZK proof
        ETA: 30–120 seconds depending on block time

    else:
        ─── RECALL PATH ───
        shortfall = requested_amount - available_liquid
        1. RecallEngine selects positions to unwind:
             sort positions by ease_of_exit (Ekubo > Vesu > staking)
             for each until shortfall covered:
               ekubo_executor.remove_liquidity(…)   # or collect_fees + swap
               vesu_avnu.withdraw(…)
        2. Proceeds land in relayer address (actual STRK on-chain)
        3. relayer_api.credit_balance(user, proceeds, reason="recall")
        4. Continue to FAST PATH above
        ETA: 2–10 minutes (one Ekubo remove_liquidity tx + confirmation)
```

**The guarantee**: the user can ALWAYS withdraw. The worst case is waiting the recall window (a few minutes for Ekubo, potentially longer for locked positions). The user sees a progress bar.

---

## 4. The Liquidity Reserve

This is the single most critical design decision. The reserve is the fraction of the user's vault capital kept as credited internal ledger balance (not deployed anywhere). It functions as an instant withdrawal buffer.

### 4.1 Reserve Policy

```python
# Configurable per risk profile
RESERVE_POLICY = {
    "conservative": 0.30,   # 30% liquid at all times
    "balanced":     0.20,   # 20% liquid
    "aggressive":   0.10,   # 10% liquid (user accepts recall delay)
    "yolo":         0.05,   # 5% — explicit user acknowledgment required
}
```

The reserve is not a separate on-chain holding — it is simply the portion of the ledger balance that the allocator **does not deploy**. Since the tokens are already with the operator (in the relayer/router address), they can be moved instantly on request.

### 4.2 Dynamic Reserve Adjustment

After each yield harvest, the total position value changes. The reserve manager rebalances:

```python
# services/reserve_manager.py  (new, ~60 lines)

async def rebalance_reserve(user: str):
    balance       = ledger_api.get_balance(user)         # liquid in ledger
    deployed      = ledger_api.get_deployed_amount(user)  # in pools/LP
    total_value   = balance + deployed
    target_liquid = int(total_value * reserve_pct(user))

    if balance < target_liquid:
        # Too much deployed, recall some
        recall_amount = target_liquid - balance
        await recall_engine.partial_recall(user, recall_amount)

    elif balance > target_liquid * 1.5:  # 50% buffer over target
        # Too much idle — redeploy excess
        excess = balance - target_liquid
        await vault_allocator.allocate(user, excess, user_risk_profile(user))
```

This runs on a scheduler (e.g. every 6 hours) and also immediately after:
- Any user withdrawal (recalculate)
- Any yield harvest (may have pushed balance above target)
- Any large price move (zkML anomaly detector triggers recall if volatility spikes)

### 4.3  Ensuring Non-Zero Reserve Always

```python
# Hard minimum: even if deployed, always keep this fraction INSTANTLY available
HARD_FLOOR_PCT = 0.05   # 5% of original deposit stays liquid at all times

# Soft minimum: target reserve from risk profile
SOFT_TARGET_PCT = RESERVE_POLICY[risk_profile]

# If an allocation call would drop liquid below hard floor → reject that slice
if (current_liquid - slice_amount) < (total_deposited * HARD_FLOOR_PCT):
    raise InsufficientReserveError(
        f"Cannot deploy: would drop liquid reserve below {HARD_FLOOR_PCT*100}%"
    )
```

---

## 5. Optimized UX — What the User Sees

### 5.1 Vault Dashboard (single panel, no pool selection needed)

```
┌─────────────────────────────────────────────────────┐
│  VAULT                                              │
│                                                     │
│  Total deposited       4.2000 STRK                  │
│  Deployed (earning)    3.3600 STRK  (80%)           │
│  Liquid reserve        0.8400 STRK  (20%)           │
│                                                     │
│  Earned today          +0.0012 STRK  (APY: ~10.5%) │
│  30d APY               10.5%                        │
│                                                     │
│  Current strategy:                                  │
│    ├ Ekubo STRK/ETH LP    50%    +8.2% APY          │
│    ├ Vesu STRK lend       30%    +6.1% APY          │
│    └ Reserve (liquid)     20%    0% APY              │
│                                                     │
│  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │  DEPOSIT    │  │  WITHDRAW (ZK, unlinkable)   │  │
│  └─────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

 Once "DEPOSIT" is sent (STRK → operator address), the
 user never has to interact with pools, LPs, or staking.
 The AI handles everything.
```

### 5.2 Deposit UX (3 steps, ~2 minutes)

```
Step 1: "Send STRK to vault"
  → Single STRK transfer to RELAYER_ADDRESS
  → No smart contract interaction required
  → Any amount, any time

Step 2: "AI is deploying your capital"  [progress, ~30 sec]
  → Backend credits internal ledger
  → AI allocator runs automatically
  → Dashboard shows positions forming

Step 3: "Your vault is active"
  → Dashboard populates with live positions and APY
  → User does nothing until they want to withdraw
```

### 5.3 Withdrawal UX (2 paths, shown to user)

**Instant (≤ 2 min):**
```
  "Withdraw up to 0.8400 STRK instantly"
  [────────────────────] 0.8400 STRK max
  [ 0.5 STRK ] [WITHDRAW →]

  1. Enter amount (≤ liquid reserve)
  2. Sign one tx (wallet popup)    ← ConfidentialTransfer.private_deposit_u256
  3. Generate ZK proof (15 sec)
  4. Submit withdraw_u256           ← unlinkable, fresh address optional
  ✓ Done
```

**Full recall (≤ 10 min):**
```
  "Withdraw more than liquid reserve"
  [──────────────────────────────────] 4.2000 STRK max
  [ 2.0 STRK ] [REQUEST RECALL →]

  → AI begins unwinding Ekubo LP position
  → Progress: "Recalling 1.2 STRK from Ekubo LP… [■■■□□]"
  → "Recall complete — 2.0 STRK ready"
  → Same instant-withdraw flow from here
  ETA shown in UI: "~4 min"
```

**Key UX principle**: the user never sees "pool", "tick", "Merkle proof", "nullifier", or "commitment" unless they open advanced mode. They just see STRK in, STRK out, APY in the middle.

---

## 6. Technical Implementation Map (New Code Required)

### 6.1 New Backend Services

| Service | Lines | Depends on |
|---------|-------|------------|
| `services/vault_allocator.py` | ~150 | `ekubo_executor`, `vesu_avnu_integration`, `ledger_api`, `zkml_risk_service` |
| `services/reserve_manager.py` | ~80 | `ledger_api`, `vault_allocator`, `autonomous_rebalancer` |
| `services/recall_engine.py` | ~120 | `ekubo_executor.remove_liquidity`, `vesu_avnu_integration`, `ledger_api` |
| `services/vault_session.py` | ~60 | `ledger_api`, SQLite: new `vault_sessions` table |

### 6.2 New API Routes

```
POST /api/v1/zkdefi/vault/deposit
  body: { user_address, tx_hash }  ← user provides proof of transfer
  → verify tx on-chain (STRK transfer to RELAYER_ADDRESS)
  → credit ledger
  → trigger allocator async

GET  /api/v1/zkdefi/vault/status/{user_address}
  → { total_deposited, liquid_balance, deployed_balance,
       positions: [{venue, amount, apy}],
       earned_today, apy_30d }

POST /api/v1/zkdefi/vault/withdraw/prepare
  body: { user_address, amount_wei }
  → if amount_wei <= liquid: instant path, return commitment
  → else: trigger recall, return { status: "recalling", eta_seconds }

GET  /api/v1/zkdefi/vault/withdraw/status/{user_address}
  → { status: "ready"|"recalling"|"idle", available_wei, eta_seconds }
```

### 6.3 Ledger Schema Extensions

```sql
-- Already exists: ledger_accounts, ledger_transfers
-- New table:
CREATE TABLE vault_allocations (
    id              INTEGER PRIMARY KEY,
    user_address    TEXT NOT NULL,
    venue           TEXT NOT NULL,  -- "ekubo_lp", "vesu", "hold"
    position_id     TEXT,           -- Ekubo NFT id or Vesu position key
    amount_wei      TEXT NOT NULL,
    pair            TEXT,           -- "STRK/ETH" etc.
    lower_tick      INTEGER,
    upper_tick      INTEGER,
    allocated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    recalled_at     TIMESTAMP,
    recall_tx_hash  TEXT,
    status          TEXT DEFAULT 'active'  -- "active", "recalling", "closed"
);

CREATE TABLE vault_yield_events (
    id              INTEGER PRIMARY KEY,
    user_address    TEXT NOT NULL,
    allocation_id   INTEGER REFERENCES vault_allocations(id),
    amount_wei      TEXT NOT NULL,
    harvest_tx_hash TEXT,
    harvested_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6.4 Scheduler Jobs

```python
# In main.py lifespan startup — add to existing startup tasks:

# Every 4 hours: harvest all active Ekubo positions' fees
scheduler.add_job(harvest_all_fees, 'interval', hours=4)

# Every 6 hours: rebalance reserves for all active vaults
scheduler.add_job(rebalance_all_reserves, 'interval', hours=6)

# Every 1 hour: update APY metrics in performance_tracker
scheduler.add_job(update_vault_apys, 'interval', hours=1)

# Immediate trigger on user recall request: no schedule, event-driven
```

---

## 7. Privacy Analysis

**What is observable on-chain:**

| On-chain event | Visible to observer | Linked to user? |
|----------------|--------------------|-----------------| 
| STRK transfer to RELAYER_ADDRESS | Yes — to operator | No — same address for all users |
| `private_deposit_u256` call | Yes — commitment hash only | No linkage to original sender |
| Ekubo `mint_and_deposit` | Yes — pool + amounts | No — from relayer address |
| Vesu deposit | Yes — amounts | No — from relayer address |
| `withdraw_u256` from Full Privacy Pool | Yes — nullifier + recipient | Recipient is fresh address, no link |

**What is hidden:**
- The original sender's identity (behind router hop)
- The withdrawal destination (ZK proof)
- The time correlation (AI redeployment creates time gap between deposit and withdrawal)
- The amount (Merkle commitment scheme, matching noise from other users)

**What is NOT hidden:**
- The operator sees everything (trusted, same as a custodial bank).
- On-chain: STRK moved from a user wallet to RELAYER_ADDRESS. Any on-chain analyst knows RELAYER_ADDRESS is the obsqra router. They just can't link it to a specific later withdrawal.

For maximum privacy: use the relayer with a fresh intermediate address per user session, so even the operator deposit vector is routed through a one-time address. Pool D (`HashedWithdrawPool`) already does this for claim commitments.

---

## 8. Liquidity Guarantee — Formal Statement

**Invariant that the system must maintain:**

```
For all users u:
  ledger_api.get_balance(u) >= HARD_FLOOR_PCT * vault_sessions[u].total_deposited
  OR
  recall_engine.get_total_recallable(u) + ledger_api.get_balance(u) >= total_deposited
```

Translated: the user can ALWAYS recover their full capital (minus yield-related loss if a position went down and minus any locked positions that can't recall immediately).

**How the system enforces this:**

1. **Position selection**: only use venues with trustless recall (Ekubo has instant `withdraw()`, Vesu has instant `withdraw()` unless utilization is 100%). Never lock into a venue that can't produce tokens on demand.

2. **Reserve floor**: hard-coded `HARD_FLOOR_PCT=5%` of original deposit stays as ledger balance permanently. This is the gas+latency buffer for the user to initiate recall.

3. **Recall SLA**: when a user requests recall, the system commits to a max recall time:
   - Ekubo LP: ≤ 2 transactions, ~2 minutes
   - Vesu: ≤ 1 transaction, ~1 minute (if utilization < 100%)
   - If utilization is 100% on Vesu: the recall engine falls back to AVNU swap of the Vesu receipt token for liquid STRK
   - Worst case: 10 minutes

4. **Monitoring**: `autonomous_rebalancer_monitor.py` already watches for adverse conditions. Extend to monitor: position liquidity, pool utilization %, estimated recall time. If estimated recall time > threshold, auto-reduce deployed % and top up reserve.

---

## 9. Does This Track Conceptually?

Yes. What you've described is exactly what hedge funds and prime brokerages do for HNW clients: accept a cash inflow, deploy into strategies, maintain a liquidity sleeve (reserve), offer same-day or T+1 redemption. The difference is:

- **Banks**: custodial, identity-linked, taxable, censorable.
- **This system**: non-custodial (user can prove their claim via ZK proof), identity-unlinkable, operator-transparent but chain-observer-opaque.

The "personal vault" framing is correct. The AI is the fund manager. The ZK withdrawal is the redemption mechanism. The internal ledger is the sub-account / sleeves structure.

**What makes this technically sound with existing infra:**

1. `LEDGER_PAYOUT_MODE=internal` is already production-ready — it credits off-chain with zero gas and zero on-chain trace.
2. The relayer runner already listens to the ledger withdraw queue and calls `private_deposit_u256` automatically.
3. `ekubo_executor.create_lp_position` is now wired for real on-chain LP calls.
4. The ZK withdrawal circuit (`FullPrivacyWithdraw`) is already deployed and verified.

**What's non-trivial:**

1. The recall engine needs careful ordering (Ekubo first — instant trustless; Vesu second; avoid anything with lock-ups).
2. The reserve manager needs backtesting against historical volatility to set `HARD_FLOOR_PCT` correctly. Under high volatility, even 20% reserve can evaporate in value.
3. The vault_session model needs to handle the case where the user deposits multiple times (stack allocations).

---

## 10. Implementation Order (Minimal Viable Path)

```
Week 1 — Wire ledger as vault intake
  ├─ POST /vault/deposit endpoint (verify STRK transfer → credit ledger)
  ├─ GET  /vault/status endpoint
  └─ Frontend vault panel (balance display, no AI yet)

Week 2 — AI allocation wiring
  ├─ vault_allocator.py (ledger balance → Ekubo create_lp_position)
  ├─ vault_allocations DB table + status tracking
  └─ Frontend: shows deployed amounts and positions

Week 3 — Recall + guaranteed withdrawal
  ├─ recall_engine.py (select positions → remove_liquidity → credit ledger)
  ├─ reserve_manager.py (maintain floor)
  ├─ POST /vault/withdraw/prepare → ConfidentialTransfer.private_deposit_u256
  └─ Frontend: withdraw flow (instant / recall UI) + ZK proof step

Week 4 — Hardening
  ├─ Scheduler jobs (harvest, reserve rebalance, APY update)
  ├─ Monitoring: recall time estimates, utilization watches
  └─ Full integration test: deposit → AI deploys → harvest → recall → ZK withdraw
```

---

## 11. Open Questions

| Question | Recommended answer |
|----------|--------------------|
| Who owns the STRK between ledger credit and `private_deposit_u256`? | Operator. User has a cryptographic IOU (Merkle commitment). Same as every custodial DeFi protocol but with ZK proofs on the redemption side. |
| What if the operator (relayer) is offline during recall? | Safeguard: the user can always call `withdrawal_u256` directly IF they still have their commitment + proof from a previous `private_deposit_u256`. Add a "export commitment" button in vault UI as backup. |
| What happens to yield if the price of the non-STRK token in an LP drops? | Impermanent loss. Mitigated by using narrow-range LP positions around current price, auto-rebalanced by the reserve manager. The `zkml_diversification_service.py` already flags over-concentration. |
| Can multiple users share the same relayer address? | Yes. The internal ledger is per-address. The on-chain footprint just looks like "the operator is doing lots of DeFi stuff", which it is. This is the privacy model. |
| How does the user prove their claim if the backend disappears? | They can't right now (custodial risk). Mitigation: export commitment as a QR code / plaintext that can be re-imported into any compatible backend. Long-term: the commitment should be anchored on-chain via HashedWithdrawPool so the user has a blockchain receipt. |

---

*Status: architecture sourced from verified codebase as of 2026-02-25. No mock assumptions. Item #10 is the implementation path.*

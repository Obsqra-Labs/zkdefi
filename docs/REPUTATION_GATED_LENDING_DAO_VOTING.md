# Trade Desk: Reputation-Gated Lending (REVISED)

**Change:** From "free vault access" → **DAO-voted borrowing rates**

---

## New Model: Vault DAOs Vote on Lending Terms

Instead of interest-free loans, vault holders vote on:
1. **Who can borrow** (reputation tier requirements)
2. **How much** (LTV limits per tier)
3. **At what rate** (competitive APR per tier)

This creates a **private lending market** within each privacy pool.

### The Flow

```
User deposits $10,000 into MODERATE_POOL
        ↓
Reputation checked: Score = 78 → Tier3
        ↓
DAO governance (vault holders voted):
├─ Tier1: Cannot borrow
├─ Tier2: Borrow up to 50% LTV at 6% APR
└─ Tier3: Borrow up to 150% LTV at 4% APR
        ↓
User borrows $15,000 at 4%
        ↓
Interest flows to vault DAO ($600/year)
        ↓
Vault holders earn dual yield:
├─ Strategy execution yield (12% APR on $10,000 = $1,200)
└─ Lending interest (4% APR on borrowed capital = interest pool)
```

### Why This Works

| Aspect | Old Model | New Model |
|--------|-----------|-----------|
| **Economic viability** | Free loans don't scale | Interest-bearing → sustainable |
| **Governance incentive** | No real leverage | DAOs vote rates → real decisions |
| **Vault holder yield** | Strategies only | Strategies + lending interest |
| **Borrower experience** | Free 7 days | Transparent rate set by DAO |
| **Privacy** | Lost with free access | Maintained through voting |
| **Competitive market** | N/A | DAOs compete on rates |

### Dual Yield Model

```
MODERATE_POOL Vault:

Total Deposited: $1,000,000
├─ Active in Strategies: $700,000 (30% idle maintained)
│  └─ Earning 12% APY = $84,000/year
│
├─ Lent out (Tier2 + Tier3): $280,000
│  ├─ Tier2 borrowing: $150,000 @ 6% = $9,000/year
│  └─ Tier3 borrowing: $130,000 @ 4% = $5,200/year
│     └─ (4% paid by borrower, some may go to incentive reserve)
│
└─ TOTAL VAULT YIELD: $98,200/year
   = 9.82% APY to vault holders
   (vs 12% from strategies alone)
```

**For borrower (Tier3):**
```
Borrow $15,000 @ 4% = $600/year interest
Use it to deploy in personal strategies
If personal strategy returns 8% = $1,200
Net gain = $600 (leverage play)
Reputation stake: if default, tier drops
```

---

## Architecture Update: DAO Lending Governance

### New Component: VaultLendingGovernor

```typescript
interface VaultLendingPolicy {
  poolId: string;
  tier1: { canBorrow: false };
  tier2: { ltv: 0.5, apr: 0.06 };
  tier3: { ltv: 1.5, apr: 0.04 };
  votedBy: string[]; // Vault holder addresses who voted
  votedAt: ISO8601;
  nextVoteWindow: ISO8601;
}

interface VaultLendingMarket {
  totalBorrowed: number;
  totalLendingInterest: number;
  averageRate: number;
  activeLoans: LoanRecord[];
}
```

### DAO Voting Flow

```
Vault Holders Notice: Market Rates Lower Elsewhere
        ↓
Submit Proposal: "Lower Tier2 from 6% to 5.5% to stay competitive"
        ↓
Voting Period (3 days): Vault holders vote with their shares
        ↓
Quorum reached (60%+), Vote passes (70%+)
        ↓
New rate takes effect: Tier2 now borrow at 5.5%
        ↓
New borrowers get competitive rate
Existing borrowers: rate adjustment per contract terms
```

### Governance Levers (DAO votes on all)

| Lever | Current | Can Vote To | Impact |
|-------|---------|-------------|--------|
| **Tier2 LTV** | 50% | 40%-60% | More/fewer tier2 borrowers |
| **Tier2 APR** | 6% | 4%-8% | Attractiveness to borrowers |
| **Tier3 LTV** | 150% | 100%-200% | Leverage available |
| **Tier3 APR** | 4% | 2%-6% | Tier3 incentive level |
| **Min reputation** | 51 (Tier2) | Adjust thresholds | Gate access tighter/looser |
| **Reserve ratio** | 30% idle | 20%-50% | Risk tolerance |

---

## Updated Services: DAO Lending Integration

### New: VaultLendingGovernanceService

```typescript
interface LendingPolicy {
  poolId: string;
  tierPolicies: Map<ReputationTier, TierLendingTerms>;
}

interface TierLendingTerms {
  tier: ReputationTier;
  ltv: number; // Loan-to-value
  apr: number; // Annual percentage rate
  canBorrow: boolean;
}

class VaultLendingGovernanceService {
  // Fetch current lending policy (DAO-voted)
  async getLendingPolicy(pool: string): Promise<LendingPolicy>;
  
  // Get all active loans in vault
  async getActiveLoans(pool: string): Promise<LoanRecord[]>;
  
  // Submit rate change proposal
  async proposeRateChange(pool: string, changes: Partial<LendingPolicy>): Promise<ProposalId>;
  
  // Vote on proposal
  async voteOnProposal(proposalId: string, vote: 'yes' | 'no'): Promise<VoteReceipt>;
  
  // Check if proposal passed
  async getProposalStatus(proposalId: string): Promise<ProposalStatus>;
}
```

### Enhanced: ReputationGatingService

```typescript
class ReputationGatingService {
  // OLD: getBorrowingRate(tier) → number | null
  // NEW: getBorrowingRate(tier, pool) → Promise<number | null>
  async getBorrowingRate(tier: ReputationTier, pool: string): Promise<number | null> {
    const policy = await this.vaultGovService.getLendingPolicy(pool);
    const tierTerms = policy.tierPolicies.get(tier);
    return tierTerms?.apr || null;
  }
  
  // OLD: getBorrowingPower(tier, deposit) → number
  // NEW: getBorrowingPower(tier, pool, deposit) → Promise<number>
  async getBorrowingPower(
    tier: ReputationTier,
    pool: string,
    deposit: number
  ): Promise<number> {
    const policy = await this.vaultGovService.getLendingPolicy(pool);
    const tierTerms = policy.tierPolicies.get(tier);
    return deposit * (tierTerms?.ltv || 0);
  }
}
```

### Enhanced: LendingAdapter

```typescript
class LendingAdapter implements ExecutionAdapter {
  async borrowFromPool(params: {
    pool: string;
    amount: number;
    address: string;
    tier: ReputationTier;
    depositAmount: number;
  }): Promise<BorrowReceipt> {
    try {
      // Fetch DAO-voted lending policy
      const policy = await this.govService.getLendingPolicy(params.pool);
      const tierTerms = policy.tierPolicies.get(params.tier);
      
      if (!tierTerms?.canBorrow) {
        throw new Error(`${params.tier} cannot borrow from this pool`);
      }
      
      // Check LTV (DAO-voted limit)
      const maxBorrow = params.depositAmount * tierTerms.ltv;
      if (params.amount > maxBorrow) {
        throw new Error(
          `Exceeds DAO LTV limit: max ${maxBorrow}, requested ${params.amount}`
        );
      }
      
      // Check pool has idle capital
      const available = await this.liquidityManager.getAvailableCapitalByTier(
        params.pool,
        params.tier
      );
      if (params.amount > available) {
        throw new Error('Insufficient idle capital in vault for this tier');
      }
      
      // Execute borrow at DAO-voted rate
      const response = await fetch(
        apiUrl(`/api/v1/dao/pools/${params.pool}/borrow`),
        {
          method: 'POST',
          body: JSON.stringify({
            amount: params.amount,
            address: params.address,
            tier: params.tier,
            apr: tierTerms.apr, // DAO-voted rate
            policyId: policy.id, // Track which policy governed this loan
          }),
        }
      );
      
      if (!response.ok) throw new Error('Borrow failed');
      
      const result = await response.json();
      
      return {
        loanId: result.loanId,
        borrowAmount: params.amount,
        rate: tierTerms.apr,
        apr: tierTerms.apr * 100,
        maxBorrow,
        tier: params.tier,
        type: 'dao_voted_lending',
        policyId: policy.id, // Link to DAO governance
      };
    } catch (error) {
      console.error('LendingAdapter: borrowFromPool error', error);
      throw error;
    }
  }
  
  // Track loan (for memory lane + yield distribution)
  async getLoanRecord(loanId: string): Promise<LoanRecord> {
    const response = await fetch(apiUrl(`/api/v1/dao/loans/${loanId}`));
    if (!response.ok) throw new Error('Failed to fetch loan');
    return await response.json();
  }
}
```

---

## Updated Reputation-Gated Pool Access

### Three Pools, Each with DAO Governance

```
┌─ CONSERVATIVE POOL
│  ├─ Total deposited: $2M
│  ├─ Idle: 40% ($800K)
│  ├─ Active strategies: 60% ($1.2M)
│  │
│  ├─ DAO-voted lending terms:
│  │  ├─ Tier1: Cannot borrow
│  │  ├─ Tier2: 40% LTV @ 5.5% APR
│  │  └─ Tier3: 100% LTV @ 3.5% APR
│  │
│  └─ Vault holder yields:
│     ├─ Strategy yield: 10% APY
│     └─ Lending interest: 2% APY (from borrowers)
│        = 12% total vault APY
│
├─ MODERATE POOL
│  ├─ Total deposited: $5M
│  ├─ Idle: 30% ($1.5M)
│  ├─ Active strategies: 70% ($3.5M)
│  │
│  ├─ DAO-voted lending terms:
│  │  ├─ Tier1: Cannot borrow
│  │  ├─ Tier2: 50% LTV @ 6% APR
│  │  └─ Tier3: 150% LTV @ 4% APR
│  │
│  └─ Vault holder yields:
│     ├─ Strategy yield: 12% APY
│     └─ Lending interest: 2.5% APY
│        = 14.5% total vault APY
│
└─ AGGRESSIVE POOL
   ├─ Total deposited: $1.5M
   ├─ Idle: 20% ($300K)
   ├─ Active strategies: 80% ($1.2M)
   │
   ├─ DAO-voted lending terms:
   │  ├─ Tier1: Cannot borrow
   │  ├─ Tier2: 60% LTV @ 7% APR
   │  └─ Tier3: 200% LTV @ 5% APR
   │
   └─ Vault holder yields:
      ├─ Strategy yield: 18% APY (higher risk)
      └─ Lending interest: 3% APY
         = 21% total vault APY
```

---

## Economic Model: Vault Holders Are Lenders

### Vault Holder Economics

```
Step 1: Deposit into MODERATE_POOL
├─ You deposit: $10,000
└─ Vault immediately allocates: 70% to strategies, 30% idle

Step 2: Earn dual yields
├─ Strategy execution: $10K × 12% = $1,200/year
├─ Your share of idle → available for lending
└─ When others borrow at 4-6% APR, vault (you) earn interest

Step 3: As vault holder, vote on terms
├─ "Lower Tier2 to 5.5% to stay competitive"
├─ "Increase Tier3 LTV to 200% for aggressive traders"
└─ "Reduce idle from 30% to 25% → more capital deployed"

Step 4: Monitor vault health
├─ Check active loans
├─ See default rates
├─ Vote on risk tolerance
└─ Earn interest on every loan
```

### Borrower Economics

```
Step 1: As Tier3 borrower
├─ Deposit: $10,000
├─ Can borrow: $15,000 (150% LTV) @ 4% APR
└─ Interest cost: $600/year

Step 2: Deploy borrowed capital
├─ Deploy $15,000 into personal strategy
├─ Strategy yields 8% = $1,200
└─ Net profit: $1,200 - $600 = $600

Step 3: Reputation stake
├─ Repay on time → reputation increases
├─ Default → reputation drops (can't borrow next time)
└─ High reputation earner gets better rates over time
```

---

## Governance Actions: Real Examples

### Example 1: Rate Competition

```
Market Event: Competitor vault drops Tier2 rate to 5%

Vault DAO Action:
├─ Members notice exodus of Tier2 borrowers
├─ Submit proposal: "Drop Tier2 rate to 5% to stay competitive"
├─ Vote: 72% in favor
├─ Change takes effect immediately
└─ New borrowers get 5%, existing may get grandfathered or adjusted

Outcome: Vault stays competitive, borrowers get best rates
```

### Example 2: LTV Adjustment

```
Market Event: Lots of leverage demand, but pool sees risk increase

Vault DAO Action:
├─ Risk metrics show correlation increase (leverage risk)
├─ Submit proposal: "Reduce Tier3 LTV from 150% to 120%"
├─ Vote: 65% in favor
├─ New Tier3 borrowers max out at 120% LTV
└─ Existing loans: continue at 150% until renewal

Outcome: Vault reduces systemic leverage risk while existing borrowers are safe
```

### Example 3: Reserve Rebalancing

```
Market Event: Vault is lending heavily, has only 15% idle (down from 30%)

Vault DAO Action:
├─ Governance alerts: "Below minimum reserve ratio"
├─ Submit proposal: "Temporarily increase idle target to 35% to reduce risk"
├─ Vote: 80% in favor (risk-averse majority)
├─ New loans capped until idle ratio recovers
└─ Yields reduced but vault is safer

Outcome: Vault prioritizes safety, borrowers understand the constraint
```

---

## Reputation-Gated Access + DAO Lending = Perfect Match

```
Reputation Gates (Who can borrow)
  ├─ Tier1: No access
  ├─ Tier2: Moderate access
  └─ Tier3: Full access + leverage

DAO Lending Governance (How much, at what rate)
  ├─ Vault holders vote on LTV per tier
  ├─ Vault holders vote on APR per tier
  ├─ Vault holders vote on min reputation
  └─ Vault holders vote on idle reserve ratio

Privacy Pools (Where capital lives)
  ├─ Conservative: Low risk, stable yields
  ├─ Moderate: Balanced risk/reward
  └─ Aggressive: High risk, high yield

= COMPLETE SYSTEM
  • Reputation filters credibility
  • DAO governs terms (competitive market)
  • Privacy pools provide the capital
  • Vault holders earn from lending
  • Borrowers get transparent, DAO-voted rates
```

---

## Updated Files to Create

### Services
- `ReputationGatingService.ts` (enhanced with pool-specific rates)
- `VaultLendingGovernanceService.ts` (NEW - DAO voting)
- `LoanTrackingService.ts` (NEW - loan monitoring)

### Adapters
- `LendingAdapter.ts` (enhanced with DAO policy enforcement)
- `PoolLiquidityManager.ts` (enhanced with DAO rate inclusion)

### Components
- `VaultGovernancePanel.tsx` (NEW - vote on lending terms)
- `LendingProposalForm.tsx` (NEW - submit rate/LTV changes)
- `ActiveLoansDisplay.tsx` (NEW - see vault's active loans)

### Tests
- 8+ new tests for VaultLendingGovernanceService
- 4+ new tests for DAO policy enforcement in LendingAdapter
- 3+ new tests for loan lifecycle

---

## Success Criteria (Updated)

✅ DAO votes on who can borrow (reputation tiers)  
✅ DAO votes on LTV per tier (how much)  
✅ DAO votes on APR per tier (at what rate)  
✅ Vault holders earn from interest (dual yield)  
✅ Borrowers get transparent, DAO-governed rates  
✅ Competitive lending market emerges  
✅ Privacy preserved throughout (commitments for private loans)  
✅ Loan history tracked for Memory Lane  

---

This is much stronger economically and governance-wise. Vault DAOs become real lenders, competing on rates, managing risk together. Brilliant refinement.

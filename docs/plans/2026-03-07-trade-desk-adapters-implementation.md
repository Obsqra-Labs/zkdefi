# Trade Desk Adapters & Reputation-Gated Pools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete privacy-first execution adapter stack supporting Swaps, LP, DCA, Limit Orders, and 3 DAO-governed Privacy Pool buckets with **reputation-gated capital access** and yield distribution.

**Architecture:** Eight modular ExecutionAdapters (Swap, LP, DCA, Limit Orders, Lending, Staking, DarkLedger, PrivacyPool) each handling one execution venue. ReputationGatingService bridges Risk Passport reputation scores to pool capital access and borrowing rates. PrivacyPools act as both yield sources and credit lines, with idle capital available for borrowing based on reputation tier.

**Tech Stack:** React/TypeScript, TanStack Query, Zustand state, Ekubo clients (swap, LP, limit orders from backend), commitment-based Dark Ledger flows, EZKL circuit evaluation for policies, Starknet account abstraction for multi-call execution.

---

## Architecture Addition: Reputation-Gated Pool Access

### The Flow

```
┌─ User's Reputation Score (from Risk Passport)
│  └─ Score maps to Tier: Tier1 (0-50) | Tier2 (51-75) | Tier3 (76-100)
│
├─ Access to Privacy Pools
│  ├─ Tier1: Can deposit, earn yield (no borrowing)
│  ├─ Tier2: Can deposit, earn yield, borrow up to 50% of deposit
│  └─ Tier3: Can deposit, earn yield, borrow up to 150% of deposit (1.5x leverage)
│
├─ Idle Capital Availability
│  ├─ Conservative Pool: 40% idle maintained for lending
│  ├─ Moderate Pool: 30% idle maintained for lending
│  └─ Aggressive Pool: 20% idle maintained for lending
│
├─ Borrowing Rates (DAO-set per pool)
│  ├─ Tier1: 8% (no access) → becomes 6% (can borrow)
│  ├─ Tier2: 6% (better rate for higher reputation)
│  └─ Tier3: 4% (best rate, can also access capital as free vault)
│
└─ Free Vault Access (Tier3 only)
   └─ Can withdraw idle capital for free, return anytime
      (no interest charged during free withdrawal period)
```

### Economic Model

**For user:**
- Tier1: 8% borrow rate (if allowed), but must have deposit collateral
- Tier2: 6% borrow rate, up to 50% LTV (loan-to-value)
- Tier3: 4% borrow rate, up to 150% LTV (with leverage), OR free vault access

**For pool:**
- Earns interest from Tier1 borrowers (8%)
- Earns interest from Tier2 borrowers (6%)
- Earns interest from Tier3 borrowers (4%) but lower rates offset by scale
- Maintains idle capital reserve to support lending
- DAO votes on rate adjustments, acceptable tiers, risk gates

---

## Task 1: Create ReputationGatingService

**Files:**
- Create: `frontend/src/services/ReputationGatingService.ts`
- Create: `frontend/src/services/__tests__/ReputationGatingService.test.ts`
- Reference: `backend/app/routes/reputation.py` (reputation endpoint)

**Rationale:** Bridges reputation scores to actual economic benefits (borrowing power, rates, free vault access).

**Step 1: Write failing tests**

Create `frontend/src/services/__tests__/ReputationGatingService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReputationGatingService } from '../ReputationGatingService';

describe('ReputationGatingService', () => {
  let service: ReputationGatingService;

  beforeEach(() => {
    service = new ReputationGatingService();
  });

  it('should fetch user reputation score', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: '0x123',
        reputationScore: 78,
        tier: 'Tier3',
        updatedAt: '2026-03-07T10:00:00Z',
      }),
    });

    global.fetch = mockFetch;

    const rep = await service.getUserReputation('0x123');

    expect(rep.reputationScore).toBe(78);
    expect(rep.tier).toBe('Tier3');
  });

  it('should map reputation score to tier', () => {
    expect(service.mapScoreToTier(25)).toBe('Tier1');
    expect(service.mapScoreToTier(65)).toBe('Tier2');
    expect(service.mapScoreToTier(85)).toBe('Tier3');
  });

  it('should return borrowing power based on tier and deposit', () => {
    const depositAmount = 10000;

    const tier1Power = service.getBorrowingPower('Tier1', depositAmount);
    const tier2Power = service.getBorrowingPower('Tier2', depositAmount);
    const tier3Power = service.getBorrowingPower('Tier3', depositAmount);

    expect(tier1Power).toBe(0); // Tier1 cannot borrow
    expect(tier2Power).toBe(5000); // 50% of deposit
    expect(tier3Power).toBe(15000); // 150% of deposit (1.5x)
  });

  it('should return borrowing rate based on tier', () => {
    const rate1 = service.getBorrowingRate('Tier1');
    const rate2 = service.getBorrowingRate('Tier2');
    const rate3 = service.getBorrowingRate('Tier3');

    expect(rate1).toBeUndefined(); // Tier1 no access
    expect(rate2).toBe(0.06); // 6%
    expect(rate3).toBe(0.04); // 4%
  });

  it('should grant free vault access for Tier3', () => {
    const hasAccess1 = service.canAccessFreeVault('Tier1');
    const hasAccess2 = service.canAccessFreeVault('Tier2');
    const hasAccess3 = service.canAccessFreeVault('Tier3');

    expect(hasAccess1).toBe(false);
    expect(hasAccess2).toBe(false);
    expect(hasAccess3).toBe(true);
  });

  it('should calculate max free withdrawal amount', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        poolIdle: 50000,
        userDeposit: 10000,
        tier: 'Tier3',
        maxFreeWithdrawal: 5000, // 50% of idle
      }),
    });

    global.fetch = mockFetch;

    const maxWithdraw = await service.getMaxFreeWithdrawal(
      'MODERATE_POOL',
      '0x123'
    );

    expect(maxWithdraw).toBeGreaterThan(0);
  });

  it('should track reputation-based access history', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [
          {
            timestamp: '2026-03-07T10:00:00Z',
            event: 'borrow',
            amount: 5000,
            rate: 0.06,
          },
          {
            timestamp: '2026-03-08T10:00:00Z',
            event: 'free_vault_access',
            amount: 2000,
          },
        ],
      }),
    });

    global.fetch = mockFetch;

    const history = await service.getAccessHistory('0x123');

    expect(history).toHaveLength(2);
    expect(history[0].event).toBe('borrow');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /opt/obsqra.starknet/zkdefi
npm run test -- frontend/src/services/__tests__/ReputationGatingService.test.ts
```

**Step 3: Implement ReputationGatingService**

Create `frontend/src/services/ReputationGatingService.ts`:

```typescript
import { apiUrl } from '@/lib/api/client';

export type ReputationTier = 'Tier1' | 'Tier2' | 'Tier3';

export interface UserReputation {
  address: string;
  reputationScore: number;
  tier: ReputationTier;
  updatedAt: ISO8601;
}

export interface AccessGrant {
  tier: ReputationTier;
  borrowingPower: number; // Max amount can borrow
  borrowingRate: number | null; // APR, null if no access
  canAccessFreeVault: boolean;
  maxFreeWithdrawal: number;
}

export interface AccessEvent {
  timestamp: ISO8601;
  event: 'borrow' | 'repay' | 'free_vault_access' | 'free_vault_return';
  amount: number;
  rate?: number;
}

export class ReputationGatingService {
  private tierThresholds = {
    Tier1: { min: 0, max: 50 },
    Tier2: { min: 51, max: 75 },
    Tier3: { min: 76, max: 100 },
  };

  async getUserReputation(address: string): Promise<UserReputation> {
    try {
      const response = await fetch(
        apiUrl(`/api/v1/zkdefi/reputation/user/${address}`),
        { method: 'GET' }
      );

      if (!response.ok) throw new Error('Failed to fetch reputation');

      return await response.json();
    } catch (error) {
      console.error('ReputationGatingService: getUserReputation error', error);
      // Return minimal default
      return {
        address,
        reputationScore: 0,
        tier: 'Tier1',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  mapScoreToTier(score: number): ReputationTier {
    if (score <= 50) return 'Tier1';
    if (score <= 75) return 'Tier2';
    return 'Tier3';
  }

  getBorrowingPower(tier: ReputationTier, depositAmount: number): number {
    // Tier1: no borrowing
    // Tier2: 50% LTV (borrow up to 50% of deposit)
    // Tier3: 150% LTV (borrow up to 1.5x deposit)
    const ltv: Record<ReputationTier, number> = {
      Tier1: 0,
      Tier2: 0.5,
      Tier3: 1.5,
    };

    return depositAmount * ltv[tier];
  }

  getBorrowingRate(tier: ReputationTier): number | null {
    // Tier1: no borrowing access
    // Tier2: 6% APR
    // Tier3: 4% APR
    const rates: Record<ReputationTier, number | null> = {
      Tier1: null,
      Tier2: 0.06,
      Tier3: 0.04,
    };

    return rates[tier];
  }

  canAccessFreeVault(tier: ReputationTier): boolean {
    // Only Tier3 can access free vault
    return tier === 'Tier3';
  }

  async getMaxFreeWithdrawal(
    poolId: string,
    address: string
  ): Promise<number> {
    try {
      const response = await fetch(
        apiUrl(
          `/api/v1/dao/pools/${poolId}/free-vault-max/${address}`
        ),
        { method: 'GET' }
      );

      if (!response.ok) throw new Error('Failed to get max withdrawal');

      const data = await response.json();
      return data.maxFreeWithdrawal || 0;
    } catch (error) {
      console.error(
        'ReputationGatingService: getMaxFreeWithdrawal error',
        error
      );
      return 0;
    }
  }

  async getAccessHistory(address: string): Promise<AccessEvent[]> {
    try {
      const response = await fetch(
        apiUrl(
          `/api/v1/zkdefi/reputation/access-history/${address}`
        ),
        { method: 'GET' }
      );

      if (!response.ok) throw new Error('Failed to get access history');

      const data = await response.json();
      return data.events || [];
    } catch (error) {
      console.error(
        'ReputationGatingService: getAccessHistory error',
        error
      );
      return [];
    }
  }

  computeAccessGrant(
    tier: ReputationTier,
    depositAmount: number
  ): AccessGrant {
    const borrowingRate = this.getBorrowingRate(tier);
    const borrowingPower = this.getBorrowingPower(tier, depositAmount);
    const canAccessFreeVault = this.canAccessFreeVault(tier);

    return {
      tier,
      borrowingPower,
      borrowingRate,
      canAccessFreeVault,
      maxFreeWithdrawal: canAccessFreeVault ? depositAmount * 0.2 : 0, // 20% of deposit for free withdrawal
    };
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm run test -- frontend/src/services/__tests__/ReputationGatingService.test.ts
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add frontend/src/services/ReputationGatingService.ts frontend/src/services/__tests__/ReputationGatingService.test.ts
git commit -m "feat(reputation-gating): add ReputationGatingService with tier-based pool access"
```

---

## Task 2: Enhance LendingAdapter with Reputation-Gated Borrowing

**Files:**
- Modify: `frontend/src/services/adapters/LendingAdapter.ts`
- Modify: `frontend/src/services/__tests__/LendingAdapter.test.ts`

**Rationale:** Integrate reputation gates into borrowing—show available credit line, apply tier-based rates.

**Step 1: Update tests with reputation scenarios**

Modify `frontend/src/services/__tests__/LendingAdapter.test.ts` (add new tests):

```typescript
// Add to existing LendingAdapter test suite:

  it('should deny borrowing for Tier1 reputation', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: 'Insufficient reputation for borrowing',
        tier: 'Tier1',
      }),
    });

    global.fetch = mockFetch;

    const borrow = adapter.borrowFromPool({
      pool: 'MODERATE_POOL',
      amount: 5000,
      address: '0x123',
      tier: 'Tier1',
    });

    await expect(borrow).rejects.toThrow();
  });

  it('should apply tier-specific borrowing rates', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          borrowAmount: 5000,
          rate: 0.06, // Tier2 rate
          apr: 6,
        }),
      });

    global.fetch = mockFetch;

    const result = await adapter.borrowFromPool({
      pool: 'MODERATE_POOL',
      amount: 5000,
      address: '0x123',
      tier: 'Tier2',
    });

    expect(result.rate).toBe(0.06);
  });

  it('should enforce borrowing power limits', async () => {
    // Tier2 can borrow up to 50% of deposit
    // If deposit is 10,000, max borrow is 5,000
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: 'Exceeds borrowing power',
        maxBorrow: 5000,
        requested: 8000,
      }),
    });

    global.fetch = mockFetch;

    const borrow = adapter.borrowFromPool({
      pool: 'MODERATE_POOL',
      amount: 8000, // Over limit
      address: '0x123',
      tier: 'Tier2',
      depositAmount: 10000,
    });

    await expect(borrow).rejects.toThrow();
  });

  it('should allow Tier3 to access free vault (no interest)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        amount: 2000,
        interestRate: 0, // FREE
        type: 'free_vault_access',
        maxDuration: 604800, // 7 days free
      }),
    });

    global.fetch = mockFetch;

    const result = await adapter.accessFreeVault({
      pool: 'MODERATE_POOL',
      amount: 2000,
      address: '0x123',
      tier: 'Tier3',
    });

    expect(result.interestRate).toBe(0);
  });
```

**Step 2: Update LendingAdapter implementation**

Modify `frontend/src/services/adapters/LendingAdapter.ts`:

```typescript
// Add imports
import { ReputationGatingService, ReputationTier } from '@/services/ReputationGatingService';

// Add new interface
export interface ReputationGatedBorrow {
  borrowAmount: number;
  rate: number;
  apr: number;
  maxBorrow: number;
  tier: ReputationTier;
  type: 'standard_borrow' | 'free_vault_access';
}

// In class, add methods:

private repGatingService = new ReputationGatingService();

async borrowFromPool(params: {
  pool: string;
  amount: number;
  address: string;
  tier: ReputationTier;
  depositAmount?: number;
}): Promise<ReputationGatedBorrow> {
  try {
    // Check if tier can borrow
    const rate = this.repGatingService.getBorrowingRate(params.tier);
    if (rate === null) {
      throw new Error('Tier1 cannot borrow');
    }

    const maxBorrow = this.repGatingService.getBorrowingPower(
      params.tier,
      params.depositAmount || 0
    );

    if (params.amount > maxBorrow) {
      throw new Error(
        `Exceeds borrowing power: max ${maxBorrow}, requested ${params.amount}`
      );
    }

    const response = await fetch(
      apiUrl(`/api/v1/zkdefi/lending/${params.pool}/borrow-reputation-gated`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: params.amount,
          address: params.address,
          tier: params.tier,
        }),
      }
    );

    if (!response.ok) throw new Error('Borrow failed');

    const result = await response.json();

    return {
      borrowAmount: params.amount,
      rate: rate,
      apr: rate * 100,
      maxBorrow: maxBorrow,
      tier: params.tier,
      type: 'standard_borrow',
    };
  } catch (error) {
    console.error('LendingAdapter: borrowFromPool error', error);
    throw error;
  }
}

async accessFreeVault(params: {
  pool: string;
  amount: number;
  address: string;
  tier: ReputationTier;
}): Promise<{ amount: number; interestRate: number; type: string; maxDuration: number }> {
  try {
    if (!this.repGatingService.canAccessFreeVault(params.tier)) {
      throw new Error('Only Tier3 can access free vault');
    }

    const response = await fetch(
      apiUrl(`/api/v1/dao/pools/${params.pool}/free-vault/access`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: params.amount,
          address: params.address,
          tier: params.tier,
        }),
      }
    );

    if (!response.ok) throw new Error('Free vault access failed');

    return await response.json();
  } catch (error) {
    console.error('LendingAdapter: accessFreeVault error', error);
    throw error;
  }
}

async returnToFreeVault(params: {
  pool: string;
  amount: number;
  address: string;
}): Promise<{ returned: number; txHash: string }> {
  try {
    const response = await fetch(
      apiUrl(`/api/v1/dao/pools/${params.pool}/free-vault/return`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: params.amount,
          address: params.address,
        }),
      }
    );

    if (!response.ok) throw new Error('Return to vault failed');

    return await response.json();
  } catch (error) {
    console.error('LendingAdapter: returnToFreeVault error', error);
    throw error;
  }
}
```

**Step 3: Run tests**

```bash
npm run test -- frontend/src/services/__tests__/LendingAdapter.test.ts
```

Expected: All tests (new + existing) PASS.

**Step 4: Commit**

```bash
git add frontend/src/services/adapters/LendingAdapter.ts frontend/src/services/__tests__/LendingAdapter.test.ts
git commit -m "feat(lending): add reputation-gated borrowing with tier-based rates and free vault access"
```

---

## Task 3: Enhance PrivacyPoolAdapter with Reputation Access

**Files:**
- Modify: `frontend/src/services/adapters/PrivacyPoolAdapter.ts`
- Create: `frontend/src/services/adapters/PoolLiquidityManager.ts` (idle capital tracking)

**Rationale:** Pools track available capital for lending, show borrowers what they can access based on reputation.

**Step 1: Create PoolLiquidityManager**

Create `frontend/src/services/adapters/PoolLiquidityManager.ts`:

```typescript
import { apiUrl } from '@/lib/api/client';

export interface PoolLiquidity {
  pool: string;
  totalDeposited: number;
  idleCapital: number;
  activeStrategies: number;
  utilizationRate: number; // 0-1
}

export interface PoolLiquidityGate {
  pool: string;
  availableForBorrowingTier1: number; // 0
  availableForBorrowingTier2: number; // 50% of idle
  availableForBorrowingTier3: number; // 80% of idle (free vault)
}

export class PoolLiquidityManager {
  async getPoolLiquidity(pool: string): Promise<PoolLiquidity> {
    try {
      const response = await fetch(
        apiUrl(`/api/v1/dao/pools/${pool}/liquidity`),
        { method: 'GET' }
      );

      if (!response.ok) throw new Error('Failed to fetch liquidity');

      return await response.json();
    } catch (error) {
      console.error('PoolLiquidityManager: getPoolLiquidity error', error);
      return {
        pool,
        totalDeposited: 0,
        idleCapital: 0,
        activeStrategies: 0,
        utilizationRate: 0,
      };
    }
  }

  async getAvailableCapitalByTier(
    pool: string
  ): Promise<PoolLiquidityGate> {
    try {
      const liquidity = await this.getPoolLiquidity(pool);

      return {
        pool,
        availableForBorrowingTier1: 0, // Tier1 cannot borrow
        availableForBorrowingTier2: Math.floor(liquidity.idleCapital * 0.5), // 50% of idle
        availableForBorrowingTier3: Math.floor(liquidity.idleCapital * 0.8), // 80% of idle
      };
    } catch (error) {
      console.error(
        'PoolLiquidityManager: getAvailableCapitalByTier error',
        error
      );
      return {
        pool,
        availableForBorrowingTier1: 0,
        availableForBorrowingTier2: 0,
        availableForBorrowingTier3: 0,
      };
    }
  }

  async canBorrowAmount(
    pool: string,
    amount: number,
    tier: string
  ): Promise<boolean> {
    try {
      const available = await this.getAvailableCapitalByTier(pool);

      switch (tier) {
        case 'Tier1':
          return false;
        case 'Tier2':
          return amount <= available.availableForBorrowingTier2;
        case 'Tier3':
          return amount <= available.availableForBorrowingTier3;
        default:
          return false;
      }
    } catch (error) {
      console.error('PoolLiquidityManager: canBorrowAmount error', error);
      return false;
    }
  }
}
```

**Step 2: Update PrivacyPoolAdapter with liquidity checks**

Modify `frontend/src/services/adapters/PrivacyPoolAdapter.ts` (add to existing file):

```typescript
// Add import
import { PoolLiquidityManager } from './PoolLiquidityManager';

// Add to class:
private liquidityManager = new PoolLiquidityManager();

async validateBorrowingCapacity(
  params: {
    pool: PoolId;
    amount: number;
    tier: string;
  }
): Promise<{ canBorrow: boolean; reason: string }> {
  const canBorrow = await this.liquidityManager.canBorrowAmount(
    params.pool,
    params.amount,
    params.tier
  );

  if (!canBorrow) {
    if (params.tier === 'Tier1') {
      return { canBorrow: false, reason: 'Tier1 cannot borrow from pools' };
    }
    return {
      canBorrow: false,
      reason: 'Insufficient idle capital available for your tier',
    };
  }

  return { canBorrow: true, reason: 'OK' };
}

async getAvailableBorrowingCapacity(
  pool: PoolId,
  tier: string
): Promise<number> {
  const available = await this.liquidityManager.getAvailableCapitalByTier(
    pool
  );

  switch (tier) {
    case 'Tier1':
      return 0;
    case 'Tier2':
      return available.availableForBorrowingTier2;
    case 'Tier3':
      return available.availableForBorrowingTier3;
    default:
      return 0;
  }
}
```

**Step 3: Update PrivacyPoolAdapter tests**

Add to `frontend/src/services/__tests__/PrivacyPoolAdapter.test.ts`:

```typescript
it('should validate borrowing capacity based on tier', async () => {
  const mockFetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({ idleCapital: 100000 }),
  });

  global.fetch = mockFetch;

  const result = await adapter.validateBorrowingCapacity({
    pool: 'MODERATE_POOL',
    amount: 30000,
    tier: 'Tier2',
  });

  expect(result.canBorrow).toBe(true);
});

it('should deny Tier1 borrowing', async () => {
  const result = await adapter.validateBorrowingCapacity({
    pool: 'MODERATE_POOL',
    amount: 5000,
    tier: 'Tier1',
  });

  expect(result.canBorrow).toBe(false);
  expect(result.reason).toContain('Tier1');
});

it('should return available borrowing by tier', async () => {
  const mockFetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({ idleCapital: 100000 }),
  });

  global.fetch = mockFetch;

  const tier2Capacity = await adapter.getAvailableBorrowingCapacity(
    'MODERATE_POOL',
    'Tier2'
  );
  const tier3Capacity = await adapter.getAvailableBorrowingCapacity(
    'MODERATE_POOL',
    'Tier3'
  );

  expect(tier2Capacity).toBe(50000); // 50% of idle
  expect(tier3Capacity).toBe(80000); // 80% of idle
});
```

**Step 4: Commit**

```bash
git add frontend/src/services/adapters/PoolLiquidityManager.ts frontend/src/services/adapters/PrivacyPoolAdapter.ts frontend/src/services/__tests__/PrivacyPoolAdapter.test.ts
git commit -m "feat(pools): add liquidity management with reputation-gated borrowing capacity"
```

---

## Summary: Complete Reputation-Gated System

### Tier Access Matrix

| Feature | Tier1 | Tier2 | Tier3 |
|---------|-------|-------|-------|
| **Deposit into pools** | ✅ | ✅ | ✅ |
| **Earn yield** | ✅ | ✅ | ✅ |
| **Borrow from pools** | ❌ | ✅ (50% LTV) | ✅ (150% LTV) |
| **Borrow rate** | — | 6% APR | 4% APR |
| **Free vault access** | ❌ | ❌ | ✅ (20% of deposit, 7 days) |
| **Max withdrawal** | Own | Own | Own + Free vault |

### Economic Flow

```
User Deposits $10,000 into MODERATE_POOL
        ↓
Reputation checked: Score = 78 → Tier3
        ↓
Access Grant:
├─ Can borrow: $15,000 (1.5x leverage)
├─ Borrow rate: 4% APR
├─ Free vault: $2,000 (20% of deposit, 7 days free)
└─ Yield earned: 12% APR on $10,000 = $1,200/year
        ↓
User chooses action:
├─ Option A: Earn passive yield only
├─ Option B: Borrow $8,000 at 4% to deploy elsewhere
└─ Option C: Withdraw $2,000 free for 7 days, then return with no interest
```

### Service Dependencies

```
ReputationGatingService
  ├─ Maps score → tier
  ├─ Calculates borrowing power
  ├─ Determines rates
  └─ Grants free vault access

LendingAdapter (enhanced)
  ├─ Uses ReputationGatingService for gating
  ├─ Enforces borrowing limits
  ├─ Applies tier-based rates
  └─ Handles free vault access/return

PrivacyPoolAdapter (enhanced)
  ├─ Uses PoolLiquidityManager
  ├─ Validates borrowing capacity
  ├─ Returns available capital by tier
  └─ Tracks idle capital distribution

PoolLiquidityManager (NEW)
  ├─ Fetches pool liquidity stats
  ├─ Allocates idle capital by tier
  └─ Validates borrowing availability
```

---

## Next Remaining Tasks

**Task 4:** Build complete adapter stack (Swap, LP, DCA, LimitOrders from earlier tasks)
**Task 5:** Create TradeDesk Main Component (integrates all adapters)
**Task 6:** Build ExecutionPanel with 3-mode toggle (Manual, Advisory, Terminal)
**Task 7:** Wire OpportunityList with reputation filtering
**Task 8:** Create Memory Lane integration (receipt display with reputation badges)
**Task 9:** Add DAO Governance UI for pool policy management
**Task 10:** End-to-end testing + verification

---

## Execution Ready

The reputation-gated pool system is **ready for implementation**. You now have:

✅ ReputationGatingService (maps reputation to economic benefits)
✅ Enhanced LendingAdapter (tier-based borrowing, free vault access)
✅ PoolLiquidityManager (idle capital allocation)
✅ Enhanced PrivacyPoolAdapter (borrowing capacity validation)
✅ TDD approach with failing tests first
✅ Complete tier access matrix

**Which execution approach?**

**Option 1: Subagent-Driven (Current Session)**
- Fresh subagent per task, review between
- Fast iteration with immediate feedback

**Option 2: Parallel Session (Separate)**
- New session with executing-plans skill
- Batch execution with checkpoints

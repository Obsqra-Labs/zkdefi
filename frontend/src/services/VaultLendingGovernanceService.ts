import { apiUrl } from '@/lib/api/client';
import { Tier } from './ReputationGatingService';

/**
 * Lending policy for a single reputation tier
 */
interface TierPolicy {
  canBorrow: boolean;
  ltv?: number;
  apr?: number;
}

/**
 * DAO-voted lending policy for a pool
 * Controls who can borrow, at what LTV, and at what rate
 */
export interface LendingPolicy {
  poolId: string;
  tier1: { canBorrow: false };
  tier2: { ltv: number; apr: number };
  tier3: { ltv: number; apr: number };
  votedBy: string[]; // Addresses of vault holders who voted
  votedAt: string; // ISO8601 timestamp of last policy vote
  nextVoteWindow: string; // ISO8601 timestamp of next governance window
}

/**
 * Mutable policy fields for governance proposals.
 * Nested tier fields are partial to support targeted updates
 * (e.g. APR-only changes without restating LTV).
 */
export interface LendingPolicyChanges {
  tier1?: Partial<LendingPolicy['tier1']>;
  tier2?: Partial<LendingPolicy['tier2']>;
  tier3?: Partial<LendingPolicy['tier3']>;
}

/**
 * Active loan record in a vault
 */
export interface LoanRecord {
  loanId: string;
  amount: number;
  rate: number;
  tier: Tier;
  status: 'active' | 'repaid' | 'defaulted';
  createdAt: string;
}

/**
 * Governance proposal for policy changes
 */
export interface Proposal {
  id: string;
  pool: string;
  proposedChanges: LendingPolicyChanges;
  proposer: string;
  votingDeadline: string; // ISO8601
  votes: { yes: number; no: number };
  status: 'open' | 'passed' | 'rejected' | 'executed';
}

/**
 * Vote receipt from casting a vote
 */
export interface VoteReceipt {
  proposalId: string;
  vote: 'yes' | 'no';
  timestamp: string;
}

/**
 * Proposal status with voting metrics
 */
export interface ProposalStatus {
  id: string;
  status: 'open' | 'passed' | 'rejected' | 'executed';
  votes: { yes: number; no: number };
  totalVoters: number;
  participationRate: number;
}

/**
 * VaultLendingGovernanceService
 *
 * Manages DAO-voted lending policies for privacy pool vaults.
 * Vault holders vote on borrowing terms (who can borrow, LTV limits, APR).
 *
 * Responsibilities:
 * 1. Fetch and cache current DAO-voted lending policies
 * 2. Provide active loan tracking for vault monitoring
 * 3. Submit governance proposals for policy changes
 * 4. Execute voting and track proposal status
 * 5. Enforce governance voting rules (70% majority, 60% quorum)
 */
export class VaultLendingGovernanceService {
  // Cache for lending policies with 5-minute expiration
  private policyCache: Map<
    string,
    { policy: LendingPolicy; timestamp: number }
  > = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Fetches current DAO-voted lending policy for a pool
   * Caches results for 5 minutes to reduce API calls
   *
   * @param pool - Pool identifier
   * @returns LendingPolicy with current DAO-voted terms
   */
  async getLendingPolicy(pool: string): Promise<LendingPolicy> {
    // Check cache
    const cached = this.policyCache.get(pool);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.policy;
    }

    const url = apiUrl(`/api/v1/dao/pools/${pool}/lending-policy`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch lending policy (${response.status})`;
      throw new Error(detail);
    }

    const policy = await response.json();

    // Cache the policy
    this.policyCache.set(pool, {
      policy,
      timestamp: Date.now(),
    });

    return policy;
  }

  /**
   * Fetches all active loans in a vault for monitoring
   * Does not cache - provides real-time loan data
   *
   * @param pool - Pool identifier
   * @returns Array of active loan records
   */
  async getActiveLoans(pool: string): Promise<LoanRecord[]> {
    const url = apiUrl(`/api/v1/dao/pools/${pool}/loans/active`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch active loans (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Submits a proposal to change lending terms for a pool
   * Only vault holders can propose
   *
   * @param pool - Pool identifier
   * @param changes - Proposed changes to lending policy
   * @returns Proposal ID
   */
  async proposeRateChange(
    pool: string,
    changes: LendingPolicyChanges
  ): Promise<string> {
    const url = apiUrl(`/api/v1/dao/pools/${pool}/governance/propose`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to submit proposal (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return data.proposalId;
  }

  /**
   * Casts a vote on an active governance proposal
   *
   * @param proposalId - Proposal identifier
   * @param vote - Vote: 'yes' or 'no'
   * @returns VoteReceipt with voting confirmation
   */
  async voteOnProposal(proposalId: string, vote: 'yes' | 'no'): Promise<VoteReceipt> {
    const url = apiUrl('/api/v1/dao/governance/vote');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId, vote }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to vote on proposal (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Checks proposal status and voting results
   *
   * Passes if:
   * - Voting deadline reached
   * - At least 60% participation (quorum)
   * - At least 70% voted 'yes' (majority)
   *
   * @param proposalId - Proposal identifier
   * @returns ProposalStatus with voting metrics
   */
  async getProposalStatus(proposalId: string): Promise<ProposalStatus> {
    const url = apiUrl(`/api/v1/dao/governance/proposal/${proposalId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch proposal status (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Invalidates cached policy for a pool
   * Called after successful proposal execution
   *
   * @param pool - Pool identifier
   */
  invalidatePolicyCache(pool: string): void {
    this.policyCache.delete(pool);
  }

  /**
   * Invalidates all cached policies
   */
  invalidateAllPolicies(): void {
    this.policyCache.clear();
  }
}

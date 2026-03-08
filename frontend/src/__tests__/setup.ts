import { vi } from 'vitest';
import type { Opportunity, MarketContext, ReceiptWithImpact, TradeReceipt } from '@/services/types';
import type { UserReputation } from '@/services/ReputationGatingService';

// Mock data factories
export const mockOpportunity = (overrides?: Partial<Opportunity>): Opportunity => ({
  id: 'opp-1',
  name: 'ETH/USDC LP',
  description: 'Liquidity provision on Ekubo',
  type: 'lp',
  tokenA: 'ETH',
  tokenB: 'USDC',
  currentYield: 12.5,
  riskScore: 30,
  tvl: 5000000,
  privacyModes: ['public', 'shielded'],
  source: 'Ekubo',
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const mockUserReputation = (overrides?: Partial<UserReputation>): UserReputation => ({
  address: '0x0',
  tier: 'Tier2',
  reputationScore: 65,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const mockTradeReceipt = (overrides?: Partial<ReceiptWithImpact>): ReceiptWithImpact => ({
  id: `receipt-${Date.now()}`,
  executedAt: new Date().toISOString(),
  type: 'lp',
  adapter: 'LPAdapter',
  status: 'executed',
  details: {
    opportunityName: 'ETH/USDC LP',
    amount: 1000,
    privacyLevel: 'public',
    yieldImpact: 12.5,
    trustDelta: 5,
  },
  transactionHash: '0xabc123',
  reputationImpact: 25,
  proofHash: '0xproof001',
  ...overrides,
});

export const mockMarketContext = (overrides?: Partial<MarketContext>): MarketContext => ({
  volatilityIndex: 45,
  sentiment: 'neutral',
  riskWarnings: ['Normal market conditions'],
  trendingPairs: [
    { tokenA: 'ETH', tokenB: 'USDC', volume24h: 2000000 },
    { tokenA: 'STRK', tokenB: 'USDC', volume24h: 1500000 },
  ],
  timestamp: new Date().toISOString(),
  ...overrides,
});

// Service mocks
export const createMockMarketDataService = () => ({
  getOpportunities: vi.fn().mockResolvedValue([
    mockOpportunity({ id: 'opp-1', type: 'lp' }),
    mockOpportunity({ id: 'opp-2', type: 'lending', name: 'USDC Lending' }),
    mockOpportunity({ id: 'opp-3', type: 'staking', name: 'STRK Staking' }),
  ]),
  getMarketContext: vi.fn().mockResolvedValue(mockMarketContext()),
  streamOpportunities: vi.fn().mockReturnValue({
    subscribe: (callback: (opps: Opportunity[]) => void) => {
      callback([mockOpportunity()]);
      return { unsubscribe: () => {} };
    },
  }),
});

export const createMockReputationGatingService = () => ({
  getUserReputation: vi.fn().mockResolvedValue(mockUserReputation()),
  checkBorrowingEligibility: vi.fn().mockResolvedValue({
    eligible: true,
    tier: 'Tier2',
    maxBorrowAmount: 50000,
    ltv: 0.5,
  }),
  updateReputation: vi.fn().mockResolvedValue({
    tier: 'Tier2',
    score: 75,
    votingPower: 2,
  }),
});

export const createMockReceiptService = () => ({
  recordReceipt: vi.fn().mockResolvedValue('receipt-123'),
  getReceipts: vi.fn().mockResolvedValue([mockTradeReceipt()]),
  getReceiptSummary: vi.fn().mockResolvedValue({
    totalExecutions: 3,
    totalYield: 35.7,
    successRate: 1.0,
    reputationGainedFromProofs: 75,
    topPerformingAdapter: 'LPAdapter',
    lastExecutionTime: new Date().toISOString(),
  }),
});

export const createMockAIRecommendationService = () => ({
  getRecommendations: vi.fn().mockResolvedValue([
    {
      opportunityId: 'opp-1',
      score: 0.85,
      reason: 'High yield with moderate risk',
      riskAdjustment: 0.05,
    },
    {
      opportunityId: 'opp-2',
      score: 0.72,
      reason: 'Stable lending opportunity',
      riskAdjustment: 0.02,
    },
  ]),
});

export const createMockVaultLendingGovernanceService = () => ({
  getLendingPolicy: vi.fn().mockResolvedValue({
    poolId: 'pool-1',
    tier1: { canBorrow: false },
    tier2: { ltv: 0.5, apr: 6 },
    tier3: { ltv: 1.5, apr: 4 },
    votedBy: ['0x123', '0x456'],
    votedAt: new Date().toISOString(),
    nextVoteWindow: new Date(Date.now() + 86400000).toISOString(),
  }),
  getActiveLoans: vi.fn().mockResolvedValue([]),
  proposeRateChange: vi.fn().mockResolvedValue('prop-123'),
  voteOnProposal: vi.fn().mockResolvedValue({
    proposalId: 'prop-1',
    vote: 'yes',
    timestamp: new Date().toISOString(),
  }),
});

// Render setup helpers
export const setupTradeTestEnvironment = () => {
  const marketService = createMockMarketDataService();
  const reputationService = createMockReputationGatingService();
  const receiptService = createMockReceiptService();
  const aiService = createMockAIRecommendationService();
  const governanceService = createMockVaultLendingGovernanceService();

  return {
    marketService,
    reputationService,
    receiptService,
    aiService,
    governanceService,
  };
};

// Event helpers for testing
export const simulateUserInteraction = {
  selectOpportunity: (element: HTMLElement) => {
    element.click();
  },
  executeManualTrade: async (executeButton: HTMLElement) => {
    executeButton.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
  },
  voteOnProposal: (voteButton: HTMLElement, vote: 'yes' | 'no') => {
    voteButton.click();
  },
};

// Opportunity - used by MarketDataService and AIRecommendationService
export interface Opportunity {
  id: string;
  name: string;
  description: string;
  type: 'swap' | 'lp' | 'lending' | 'staking' | 'dca' | 'limit_orders';
  tokenA?: string;
  tokenB?: string;
  currentYield: number; // APY percentage
  riskScore: number; // 0-100
  tvl?: number;
  privacyModes: ('public' | 'shielded' | 'dark_ledger')[];
  source: 'zkGraph' | 'zkRAG' | 'Ekubo' | 'Strategy';
  updatedAt: string; // ISO8601
}

// PoolData - used by MarketDataService
export interface PoolData {
  poolId: string;
  token0: string;
  token1: string;
  liquidity: number;
  volume24h: number;
  apy: number;
  tvl: number;
  fee: number; // 0.01, 0.05, 0.3, 1.0
  riskFactors: { impermanentLoss: number; slippage: number };
  lastUpdated: string; // ISO8601
}

// MarketContext - used by MarketDataService
export interface MarketContext {
  volatilityIndex: number; // 0-100
  sentiment: 'bullish' | 'neutral' | 'bearish';
  riskWarnings: string[];
  trendingPairs: { tokenA: string; tokenB: string; volume24h: number }[];
  timestamp: string; // ISO8601
}

// Recommendation - used by AIRecommendationService
export interface Recommendation {
  id: string;
  action: string;
  reasoning: string;
  type: 'yield' | 'risk_reduction' | 'rebalance' | 'opportunity';
  expectedYield: number;
  expectedRiskReduction: number;
  confidence: number; // 0-1
  createdAt: string; // ISO8601
}

// RebalanceSuggestion - used by AIRecommendationService
export interface RebalanceSuggestion {
  changes: { opportunityId: string; action: 'increase' | 'decrease'; amount: number }[];
  rationale: string;
  expectedRiskReduction: number;
  expectedYieldImpact: number;
}

// MarketInsights - used by AIRecommendationService
export interface MarketInsights {
  emergingOpportunities: Opportunity[];
  warnings: string[];
  narrativeExplanation: string;
  timestamp: string; // ISO8601
}

// TradeReceipt - used by ReceiptService (already defined in adapters)
export interface TradeReceipt {
  id: string;
  type: 'swap' | 'lp' | 'lending' | 'dca' | 'limit_orders';
  status: 'pending' | 'executed' | 'failed';
  executedAt: string; // ISO8601
  adapter: string;
  transactionHash?: string;
  details: Record<string, any>;
}

// ReceiptWithImpact - used by ReceiptService
export interface ReceiptWithImpact extends TradeReceipt {
  reputationImpact: number;
  proofHash?: string;
  explanationFromAI?: string;
}

// ReceiptSummary - used by ReceiptService
export interface ReceiptSummary {
  totalExecutions: number;
  totalYield: number;
  successRate: number;
  reputationGainedFromProofs: number;
  topPerformingAdapter: string;
  lastExecutionTime: string; // ISO8601
}

// ExecutionPanel execution parameters
export interface ExecutionParams {
  amount: number;
  slippage: number; // 0-100 basis points (e.g., 50 = 0.5%)
  privacyLevel: "public" | "shielded" | "dark_ledger";
  adapterId?: string; // For adapters that support multiple instances
}

// Adapter-specific options (override-able by manual mode)
export interface AdapterOptions {
  [key: string]: any;
}

// Real-time impact estimation
export interface EstimatedImpact {
  estimatedYield: number; // APY %
  estimatedRisk: "low" | "medium" | "high";
  slippageExposure: number; // % amount lost to slippage
  privacyExposure: number; // 0-100 exposure score
  reputationImpact?: number; // Change in reputation score
  confidence: number; // 0-100 confidence in estimate
}

// AI Recommendation for Advisory mode
export interface AIExecutionRecommendation extends Recommendation {
  recommendedPrivacyLevel: "public" | "shielded" | "dark_ledger";
  recommendedAmount: number;
  recommendedSlippage: number;
  explanationForAmount: string;
}

// Terminal mode policy
export interface TerminalModePolicy {
  id: string;
  condition: string; // e.g., "rebalance when drift > 5%"
  executionFrequency: "on_trigger" | "daily" | "weekly";
  isActive: boolean;
  createdAt: string;
}

// Execution log entry for Terminal mode
export interface ExecutionLogEntry {
  timestamp: string;
  action: string;
  status: "pending" | "executed" | "failed";
  details: string;
  receipt?: TradeReceipt;
}

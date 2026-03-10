/**
 * Seeded data for Capital OS strip and Oracle in demo mode.
 * Single fixture used by agent page strip and Oracle Signals/Radar/Genome tabs.
 */

import type { CapitalOSStripIdentity, CapitalOSStripGate, CapitalOSStripLedger } from "@/components/zkdefi/CapitalOSStrip";
import type { OracleOpportunity, OracleRecommendation } from "@/components/zkdefi/oracle/types";

export const DEMO_STRIP = {
  identity: {
    addressOrId: "0x0000000000000000000000000000000000000000000000000000000000000000",
    tier: "Pathfinder",
    proofCount: 12,
  } satisfies CapitalOSStripIdentity,
  gate: {
    riskTolerance: "Moderate",
    allowedCount: 4,
    totalCount: 6,
    status: "ok" as const,
    allowedList: ["LP Provisioning", "Lending", "Stable Yield"],
    blockedList: ["High Volatility", "Leverage"],
  } satisfies CapitalOSStripGate,
  ledger: {
    lastEntryLabel: "LP Deploy +2,400 STRK",
    receiptCount: 12,
  } satisfies CapitalOSStripLedger,
};

export const DEMO_OPPORTUNITIES: OracleOpportunity[] = [
  { pair: "STRK/ETH", estimated_apy_pct: 22, risk_score: 35, volatility: 25, tvl_usd: 120000, confidence: "high", proof_status: "Verified", signal_strength: 85 },
  { pair: "ETH/USDC", estimated_apy_pct: 18, risk_score: 28, volatility: 15, tvl_usd: 250000, confidence: "high", proof_status: "Verified", signal_strength: 90 },
  { pair: "STRK/USDC", estimated_apy_pct: 15, risk_score: 45, volatility: 30, tvl_usd: 80000, confidence: "medium", proof_status: "Experimental", signal_strength: 70 },
  { pair: "ETH/USDT", estimated_apy_pct: 12, risk_score: 22, volatility: 10, tvl_usd: 300000, confidence: "high", proof_status: "Verified", signal_strength: 88 },
  { pair: "STRK/ETH Wide", estimated_apy_pct: 19, risk_score: 40, volatility: 20, tvl_usd: 95000, confidence: "medium", proof_status: "Experimental", signal_strength: 75 },
];

export const DEMO_RECOMMENDATIONS: OracleRecommendation[] = [
  { label: "Allocate 12% to STRK/ETH Ekubo LP", strategyName: "STRK/ETH", allocationPct: 12 },
  { label: "Add 8% to ETH/USDC stable pool", strategyName: "ETH/USDC", allocationPct: 8 },
  { label: "Diversify with STRK/USDC", strategyName: "STRK/USDC", allocationPct: 5 },
];

export const DEMO_NEXT_STEP = {
  copy: "Agent running — 3 opportunities in Oracle",
  action: "oracle" as const,
  actionLabel: "View Signals",
};

export const DEMO_AI_INSIGHT = {
  message: "Ekubo ETH/STRK pool APY jumped 3.2% in 24h",
  reasoning: "Your reputation qualifies for relayed withdrawals",
};

export const DEMO_TRENDING = {
  strkEth24h: 2.4,
  topPool: { name: "STRK/ETH", apy: 22.0 },
  vaultTvl: 1200000,
  activeDepositors: 47,
  avgApy: 18.5,
};

export const DEMO_ALLOCATION = {
  ekubo: 60,
  lending: 25,
  staking: 10,
  idle: 5,
  blendedApy: 19.2,
};

export const DEMO_DCA = {
  pair: "STRK → strkBTC",
  amountPerInterval: 100,
  interval: "daily",
  nextExecution: new Date(Date.now() + 86400000).toISOString(),
  totalExecuted: 5,
  totalAmount: 500,
};

/** Demo address used to detect demo mode in Oracle tabs when strip uses demo. */
export const DEMO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Demo vault summary for OverviewTab when in guest mode. */
export const DEMO_VAULT_SUMMARY = {
  total_usd: 1000,
  strk_balance: 2000,
  eth_balance: 0,
};

/** Demo activity feed for OverviewTab. */
export const DEMO_ACTIVITY = [
  { timestamp: new Date(Date.now() - 3600000).toISOString(), description: "Deposited 500 STRK → Conservative Pool", tx_hash: "0xdemo_tx_1abc" },
  { timestamp: new Date(Date.now() - 86400000).toISOString(), description: "Deposited 800 STRK → Moderate Pool", tx_hash: "0xdemo_tx_2def" },
  { timestamp: new Date(Date.now() - 172800000).toISOString(), description: "Yield harvest +8.4 STRK (Conservative)", tx_hash: "0xdemo_tx_3ghi" },
  { timestamp: new Date(Date.now() - 432000000).toISOString(), description: "Deposited 400 STRK → Aggressive Pool", tx_hash: "0xdemo_tx_4jkl" },
  { timestamp: new Date(Date.now() - 604800000).toISOString(), description: "Agent auto-rebalanced 200 STRK Moderate → Conservative", tx_hash: "0xdemo_tx_5mno" },
];

/** Demo pool composition for CapitalTab PoolBucketCards. */
export const DEMO_POOL_COMPOSITIONS: Record<string, {
  pool_id: string; total_value_usd: number; idle_value_usd: number;
  deployed_value_usd: number; blended_apy: number;
  positions: Array<{ id: string; adapter: string; pair?: string; value_usd: number; apy: number; status: string }>;
  idle_breakdown: Record<string, number>; agent_status: string; next_eval_seconds: number;
}> = {
  conservative: {
    pool_id: "conservative", total_value_usd: 250, idle_value_usd: 50,
    deployed_value_usd: 200, blended_apy: 8.2,
    positions: [
      { id: "p1", adapter: "lending", pair: "STRK/USDC", value_usd: 120, apy: 7.5, status: "active" },
      { id: "p2", adapter: "staking", pair: "STRK", value_usd: 80, apy: 9.1, status: "delegated" },
    ],
    idle_breakdown: { STRK: 100 }, agent_status: "monitoring", next_eval_seconds: 1800,
  },
  moderate: {
    pool_id: "moderate", total_value_usd: 550, idle_value_usd: 100,
    deployed_value_usd: 450, blended_apy: 15.4,
    positions: [
      { id: "p3", adapter: "ekubo_lp", pair: "STRK/ETH", value_usd: 280, apy: 18.3, status: "in_range" },
      { id: "p4", adapter: "lending", pair: "ETH/USDC", value_usd: 170, apy: 11.2, status: "active" },
    ],
    idle_breakdown: { STRK: 200 }, agent_status: "monitoring", next_eval_seconds: 900,
  },
  aggressive: {
    pool_id: "aggressive", total_value_usd: 200, idle_value_usd: 30,
    deployed_value_usd: 170, blended_apy: 24.7,
    positions: [
      { id: "p5", adapter: "ekubo_lp", pair: "STRK/ETH Wide", value_usd: 170, apy: 24.7, status: "in_range" },
    ],
    idle_breakdown: { STRK: 60 }, agent_status: "monitoring", next_eval_seconds: 600,
  },
};

/** Demo health passport for IdentityBadge. */
export const DEMO_HEALTH = {
  tier: 2,
  tier_name: "Express",
  trust_score: 70,
  proof_count: 12,
  credit_score: 720,
};

/** Demo agent status for AgentControls. */
export const DEMO_AGENT = {
  status: { state: "monitoring", running: true, policy_name: "balanced_yield" },
  constraints: { risk_tolerance: 50, venue_limits: { venues: ["ekubo", "avnu"], ekubo_pct: 60, lending_pct: 25 } },
  session: { active: true, expires_in: "5h 30m" },
  rebalance_mode: "oracle" as const,
};

/** Realistic demo commitments across all 3 pools for showcase. */
export const DEMO_COMMITMENTS = [
  {
    id: "demo-cons-1",
    method: "commitment_shield" as const,
    asset: "STRK" as const,
    amount_wei: "500000000000000000000",
    commitment_hash: "0xdemo_cons1",
    pool_type: 0,
    pool_variant: "conservative",
    deposited_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    yield_accrued: "8400000000000000000",
  },
  {
    id: "demo-mod-1",
    method: "nullifier_set" as const,
    asset: "STRK" as const,
    amount_wei: "800000000000000000000",
    commitment_hash: "0xdemo_mod1",
    pool_type: 1,
    pool_variant: "moderate",
    deposited_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    yield_accrued: "19200000000000000000",
  },
  {
    id: "demo-mod-2",
    method: "hashed_proof" as const,
    asset: "STRK" as const,
    amount_wei: "300000000000000000000",
    commitment_hash: "0xdemo_mod2",
    pool_type: 1,
    pool_variant: "moderate",
    deposited_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    yield_accrued: "4500000000000000000",
  },
  {
    id: "demo-aggr-1",
    method: "nullifier_set" as const,
    asset: "STRK" as const,
    amount_wei: "400000000000000000000",
    commitment_hash: "0xdemo_aggr1",
    pool_type: 2,
    pool_variant: "aggressive",
    deposited_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    yield_accrued: "11700000000000000000",
  },
];

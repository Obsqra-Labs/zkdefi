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

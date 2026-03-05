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
  {
    pair: "STRK/ETH",
    estimated_apy_pct: 22,
    risk_score: 35,
    volatility: 25,
    tvl_usd: 120000,
    confidence: "high",
    proof_status: "Verified",
    signal_strength: 85,
    zkml_risk_score: 32,
    zkml_confidence: 1.0,
    zkml_flags: [],
    zkml_signals: {
      il_acceptable: true,
      yield_near_optimal: true,
      slippage_ok: true,
      gates_passed: 3,
      gates_total: 3,
      proof_hash: "0xabc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
    },
    genome_factors: {
      yield_score: 22,
      risk_score: 32,
      volatility_score: 50,
      liquidity_score: 65,
      efficiency_score: 18.4,
    },
  },
  {
    pair: "ETH/USDC",
    estimated_apy_pct: 18,
    risk_score: 28,
    volatility: 15,
    tvl_usd: 250000,
    confidence: "high",
    proof_status: "Verified",
    signal_strength: 90,
    zkml_risk_score: 25,
    zkml_confidence: 1.0,
    zkml_flags: [],
    zkml_signals: {
      il_acceptable: true,
      yield_near_optimal: true,
      slippage_ok: true,
      gates_passed: 3,
      gates_total: 3,
      proof_hash: "0x789def123abc456789def0123abc456789def0123abc456789def0123abc4567de",
    },
    genome_factors: {
      yield_score: 18,
      risk_score: 25,
      volatility_score: 30,
      liquidity_score: 80,
      efficiency_score: 22.1,
    },
  },
  {
    pair: "STRK/USDC",
    estimated_apy_pct: 15,
    risk_score: 45,
    volatility: 30,
    tvl_usd: 80000,
    confidence: "medium",
    proof_status: "Experimental",
    signal_strength: 70,
    zkml_risk_score: 42,
    zkml_confidence: 0.85,
    zkml_flags: ["circuit_warnings_volatility"],
    zkml_signals: {
      il_acceptable: true,
      yield_near_optimal: false,
      slippage_ok: true,
      gates_passed: 2,
      gates_total: 3,
      proof_hash: "0x456abc789def012abc456789def012abc456789def012abc456789def012abc45f",
    },
    genome_factors: {
      yield_score: 15,
      risk_score: 42,
      volatility_score: 60,
      liquidity_score: 45,
      efficiency_score: 14.2,
    },
  },
  {
    pair: "ETH/USDT",
    estimated_apy_pct: 12,
    risk_score: 22,
    volatility: 10,
    tvl_usd: 300000,
    confidence: "high",
    proof_status: "Verified",
    signal_strength: 88,
    zkml_risk_score: 20,
    zkml_confidence: 1.0,
    zkml_flags: [],
    zkml_signals: {
      il_acceptable: true,
      yield_near_optimal: true,
      slippage_ok: true,
      gates_passed: 3,
      gates_total: 3,
      proof_hash: "0x012def456abc789def012abc456789def012abc456789def012abc456789def01ac",
    },
    genome_factors: {
      yield_score: 12,
      risk_score: 20,
      volatility_score: 20,
      liquidity_score: 90,
      efficiency_score: 19.8,
    },
  },
  {
    pair: "STRK/ETH Wide",
    estimated_apy_pct: 19,
    risk_score: 40,
    volatility: 20,
    tvl_usd: 95000,
    confidence: "medium",
    proof_status: "Experimental",
    signal_strength: 75,
    zkml_risk_score: 38,
    zkml_confidence: 0.9,
    zkml_flags: [],
    zkml_signals: {
      il_acceptable: true,
      yield_near_optimal: true,
      slippage_ok: false,
      gates_passed: 2,
      gates_total: 3,
      proof_hash: "0x789abc012def456abc789def012abc456789def012abc456789def012abc4567bc",
    },
    genome_factors: {
      yield_score: 19,
      risk_score: 38,
      volatility_score: 40,
      liquidity_score: 52,
      efficiency_score: 16.5,
    },
  },
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

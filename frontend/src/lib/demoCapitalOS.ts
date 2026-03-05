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

/** Demo address used to detect demo mode in Oracle tabs when strip uses demo. */
export const DEMO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";

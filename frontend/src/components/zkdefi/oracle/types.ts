/**
 * Shared types for Oracle (Signals, Radar, Genome).
 * Matches POST /api/v1/strategies/opportunities response and demo fixtures.
 */

export interface OracleOpportunity {
  strategy_id?: string;
  id?: string;
  name?: string;
  pair?: string;
  best_venue?: string;
  estimated_apy_pct?: number;
  apy?: number;
  risk_score?: number;
  volatility?: number;
  tvl_usd?: number;
  tvl?: number;
  signal_strength?: number;
  confidence?: string;
  proof_status?: string;
  flags?: string[];
}

export interface OracleRecommendation {
  label: string;
  strategyName?: string;
  allocationPct?: number;
}

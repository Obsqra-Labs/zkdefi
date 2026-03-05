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
  zkml_risk_score?: number;
  zkml_confidence?: number;
  zkml_flags?: string[];
  zkml_proof_hash?: string;
  zkml_signals?: {
    il_acceptable?: boolean;
    yield_near_optimal?: boolean;
    slippage_ok?: boolean;
    gates_passed?: number;
    gates_total?: number;
    proof_hash?: string;
  };
  genome_factors?: {
    yield_score?: number;
    risk_score?: number;
    volatility_score?: number;
    liquidity_score?: number;
    efficiency_score?: number;
  };
}

export interface OracleRecommendation {
  label: string;
  strategyName?: string;
  allocationPct?: number;
}

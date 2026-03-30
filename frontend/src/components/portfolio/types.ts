export type SupportedAsset = "ETH" | "STRK" | "USDC";
export type ActionType = "swap" | "rebalance";

export type PortfolioPosition = {
  asset_symbol: string;
  amount: number;
  value_usd: number;
};

export type PortfolioSnapshot = {
  wallet_address: string;
  positions: PortfolioPosition[];
  total_value_usd: number;
  protocol_count: number;
  position_count: number;
  wallet_token_count: number;
  wallet_positions_value_usd: number;
  defi_positions_value_usd: number;
  protocols_found: string[];
  wallet_assets_found: string[];
  snapshot_hash: string;
  scanned_at: string;
};

export type PolicySnapshot = {
  policy_version: string;
  allowed_assets: string[];
  allowed_adapters: string[];
  max_value_per_action_usd: number;
  max_slippage_bps: number;
  cooldown_seconds: number;
  max_swaps_per_rebalance: number;
  min_amounts?: Record<SupportedAsset, number>;
  paused: boolean;
  min_reputation_score?: number;
  max_risk_score?: number;
  policy_hash: string;
};

export type ExecutorReadiness = {
  network_id: string;
  rpc_url: string;
  account_path: string;
  account_address: string;
  live_submit_enabled: boolean;
  starkli_available: boolean;
  account_configured: boolean;
  private_key_configured: boolean;
  account_deployed: boolean;
  can_submit_live: boolean;
  gate_live_submission_allowed: boolean;
  mode: "live" | "preview";
};

export type TelemetrySummary = {
  owner_address: string;
  recent_receipt_count: number;
  status_counts: Record<string, number>;
  submitted_count: number;
  settled_count: number;
  success_rate_pct?: number | null;
  top_failure_buckets: Array<{
    bucket: string;
    count: number;
  }>;
  recent_failures: Array<{
    receipt_id: string;
    timestamp: string;
    action_type?: string;
    stage?: string;
    status: string;
    bucket: string;
    reason: string;
  }>;
  in_flight: Array<{
    receipt_id: string;
    timestamp: string;
    action_type?: string;
    status: string;
    tx_hash?: string | null;
    venue?: string | null;
  }>;
};

export type ConstraintResult = {
  name: string;
  kind: "zkml" | "policy";
  passed: boolean;
  reason: string;
  success?: boolean;
  warning?: boolean;
  severity?: "info" | "warning" | "blocked";
  estimated_fee_usd?: number;
  fee_share_pct?: number;
  proof_hash?: string | null;
  duration_ms?: number | null;
};

export type SwapStep = {
  from_asset: SupportedAsset;
  to_asset: SupportedAsset;
  amount: number;
  amount_wei: number;
  value_usd: number;
};

export type PreparedCalldata = {
  contract_address?: string;
  entrypoint?: string;
  calldata?: string[];
  error?: string | null;
};

export type WalletPreparedCall = {
  contract_address: string;
  entrypoint: string;
  calldata: string[];
};

export type PreparedCall = {
  step: SwapStep;
  status: "ready" | "error";
  calldata?: PreparedCalldata;
  wallet_calls?: WalletPreparedCall[];
  execution_adapter?: string;
  route?: string[];
  error?: string;
};

export type GateResult = {
  execution_chain?: string;
  allowed: boolean;
  reason_codes: string[];
  constraint_results: ConstraintResult[];
  policy_hash: string;
  intent_hash: string;
  proof_mode: string;
  route_hash: string;
  estimated_gas: number;
  estimated_cost_usd: number;
  current_allocations: Record<SupportedAsset, number>;
  swap_steps: SwapStep[];
  receipt_id?: string;
  execution_preview?: {
    status?: string;
    execution_adapter?: string;
    expected_out?: string;
    route?: string[];
    warning?: string | null;
    error?: string | null;
    failure_bucket?: string | null;
    prep_latency_ms?: number;
    prepared_call_count?: number;
    wallet_call_count?: number;
    cache_hit_count?: number;
    cache_hit?: boolean;
  };
};

export type AllocationSnapshot = {
  captured_at?: string;
  snapshot_hash?: string | null;
  total_value_usd?: number;
  allocations?: Partial<Record<SupportedAsset, number>>;
  balances?: Partial<Record<SupportedAsset, { amount?: number; value_usd?: number }>>;
};

export type Receipt = {
  receipt_id: string;
  action_type?: string;
  tx_hash?: string | null;
  timestamp: string;
  metadata?: {
    stage?: "check" | "execute" | "policy" | "monitor";
    status?: string;
    allowed?: boolean;
    reason_codes?: string[];
    gate?: {
      policy_hash?: string;
      intent_hash?: string;
      route_hash?: string;
      target_allocations?: Partial<Record<SupportedAsset, number>>;
      swap_steps?: SwapStep[];
    };
    policy?: {
      changed_fields?: string[];
      before?: PolicySnapshot;
      after?: PolicySnapshot;
    };
    monitor?: {
      reviewed_at?: string;
      source?: string;
      drift_status?: RecommendationDriftStatus;
      total_turnover_pct?: number;
      estimated_turnover_usd?: number;
      largest_gap_asset?: SupportedAsset;
      largest_gap_pct?: number;
      explanation?: string;
      drivers?: Array<{
        kind?: string;
        label?: string;
        confidence?: string;
        evidence?: string;
        suggested_action?: string;
      }>;
    };
    execution?: {
      warning?: string | null;
      execution_chain?: string;
      execution_adapter?: string;
      tx_status?: string;
      portfolio_before?: AllocationSnapshot;
      portfolio_after?: AllocationSnapshot;
    };
  };
};

export type RecommendationSignal = {
  circuit: string;
  verified: boolean;
  proof_type: string;
  constraint: string;
  fact_registry: string;
};

export type RecommendationPool = {
  pool_id: string;
  protocol: string;
  pair: string;
  allocation_percent: number;
  allocation_amount: number;
  expected_apy: number;
  risk_score: number;
  risk_flags: string[];
  zkml_signal?: RecommendationSignal | null;
  adapter_ready?: boolean;
};

export type RecommendationGenome = {
  yield: number;
  risk: number;
  volatility: number;
  liquidity: number;
  efficiency: number;
};

export type RecommendationProvenance = {
  fact_registry?: string;
  garaga_verifier?: string;
  circuits_used?: string[];
  proof_types?: string[];
  settlement?: string;
};

export type RecommendationTranslationSleeve = {
  pool_id?: string;
  protocol?: string;
  pair?: string;
  allocation_percent?: number;
  portfolio_v1_mode?: string;
  directly_executable_on_portfolio_v1?: boolean;
  translated_asset_targets?: Partial<Record<SupportedAsset, number>>;
  note?: string;
};

export type RecommendationExecutionTranslation = {
  mode?: string;
  direct_execution_supported?: string[];
  strategy_sleeves_are_advisory?: boolean;
  target_allocations?: Partial<Record<SupportedAsset, number>>;
  rebalance_step_count?: number;
  sleeves?: RecommendationTranslationSleeve[];
  user_message?: string;
};

export type RecommendationDriftAsset = {
  asset: SupportedAsset;
  current_pct: number;
  target_pct: number;
  gap_pct: number;
  abs_gap_pct: number;
};

export type RecommendationDriftStatus = "aligned" | "watch" | "rebalance";

export type RecommendationDriftMonitor = {
  status?: RecommendationDriftStatus;
  monitoring_mode?: string;
  rebalance_trigger_pct?: number;
  watch_trigger_pct?: number;
  total_turnover_pct?: number;
  estimated_turnover_usd?: number;
  largest_gap_asset?: SupportedAsset;
  largest_gap_pct?: number;
  assets_out_of_band?: RecommendationDriftAsset[];
  next_review_seconds?: number;
  explanation?: string;
  last_reviewed_at?: string;
  last_alerted_at?: string;
  drivers?: Array<{
    kind?: string;
    label?: string;
    confidence?: string;
    evidence?: string;
    suggested_action?: string;
  }>;
};

export type RecommendationSummary = {
  headline?: string;
  why?: string;
  top_changes?: Array<{
    asset: SupportedAsset;
    current_pct: number;
    target_pct: number;
    delta_pct: number;
    direction: "increase" | "decrease" | "hold";
  }>;
};

export type Recommendation = {
  rationale: string;
  source: string;
  recommendation_mode?: "allocator_target" | "best_next_move";
  recommendation_note?: string | null;
  risk_profile?: string;
  risk_tolerance?: number;
  tracked_capital_usd?: number;
  constraint_context?: {
    risk_tolerance?: number;
    max_position_pct?: number;
    rebalance_frequency_seconds?: number;
    allowed_execution_venues?: string[];
    execution_mode?: string;
  };
  current_allocations: Record<SupportedAsset, number>;
  target_allocations: Record<SupportedAsset, number>;
  allocator_target_allocations?: Record<SupportedAsset, number>;
  estimated_swap_count: number;
  recommended_pools?: RecommendationPool[];
  expected_portfolio_apy?: number;
  ai_confidence?: number;
  portfolio_risk_assessment?: string;
  recommendation_id?: string | null;
  attestation_hash?: string | null;
  provenance?: RecommendationProvenance | null;
  genome?: RecommendationGenome | null;
  derived_swap_steps?: SwapStep[];
  allocator_swap_steps?: SwapStep[];
  execution_translation?: RecommendationExecutionTranslation | null;
  drift_monitor?: RecommendationDriftMonitor | null;
  rebalance_summary?: RecommendationSummary | null;
  execution_fit?: {
    mode?: string;
    description?: string;
  };
  intent: Record<string, unknown>;
};

export type ExecutionResponse = {
  status: string;
  tx_hash?: string | null;
  receipt_id: string;
  gate: GateResult;
  warning?: string | null;
  error?: string | null;
  calldata?: PreparedCalldata;
  wallet_calls?: WalletPreparedCall[];
  prepared_calls?: PreparedCall[];
  execution_chain?: string;
  execution_adapter?: string;
  expected_out?: string;
  route?: string[];
  live_submission_allowed?: boolean;
};

export type PolicyDraft = {
  paused: boolean;
  maxValueUsd: string;
  maxSlippageBps: string;
  cooldownSeconds: string;
  maxSwaps: string;
  minAmounts: Record<SupportedAsset, string>;
};

export type ActivityItem = {
  id: string;
  title: string;
  summary: string;
  status: string;
  timestamp: string;
  txHref?: string | null;
};

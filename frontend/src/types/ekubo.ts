export type ExecutionMode = "wallet" | "orchestrated";
export type ExecutionModeRequest = ExecutionMode | "auto";
export type RiskProfile = "conservative" | "neutral" | "aggressive";

export interface SwapQuoteRequest {
  token_in: string;
  token_out: string;
  amount_in: string;
  slippage_bps: number;
  taker_address?: string;
}

export interface SwapQuoteResponse {
  expected_out: string;
  min_out: string;
  price_impact_bps: number;
  route: string[];
  expires_at: string;
  warnings?: string[];
}

export interface DexQuoteRequest {
  token_in: string;
  token_out: string;
  amount_in: string;
}

export interface DexQuoteResponse {
  amount_out: string;
  amount_out_min: string;
  pool_fee?: string;
  pool_core_address?: string;
  message?: string;
}

export type DexVenue = "ekubo" | "avnu";

export interface AggregatedDexQuoteRequest extends DexQuoteRequest {
  slippage_bps?: number;
  taker_address?: string;
}

export interface DexVenueQuote {
  venue: DexVenue;
  amount_out: string;
  amount_out_min: string;
  quote_id?: string;
  route: string[];
  message?: string;
}

export interface AggregatedDexQuoteResponse {
  selected_venue: DexVenue;
  amount_out: string;
  amount_out_min: string;
  selected_quote_id?: string;
  selected_route: string[];
  message?: string;
  venues: DexVenueQuote[];
}

export interface AvnuQuoteRequest extends DexQuoteRequest {
  slippage_bps?: number;
  taker_address?: string;
}

export interface AvnuQuoteResponse {
  venue: "avnu";
  quote_id: string;
  amount_out: string;
  amount_out_min: string;
  route: string[];
  message?: string;
}

export interface DexContractCall {
  contract_address: string;
  entrypoint: string;
  calldata: string[];
}

export interface AvnuBuildRequest {
  quote_id: string;
  taker_address: string;
  slippage_bps?: number;
  include_approve?: boolean;
}

export interface AvnuBuildResponse {
  venue: "avnu";
  chain_id?: string;
  calls: DexContractCall[];
  message?: string;
}

export interface BuildApproval {
  token: string;
  spender: string;
  amount: string;
}

export interface BuildCall {
  contract_address: string;
  entrypoint: string;
  calldata: string[];
}

export interface BuildTxResponse {
  execution_mode: ExecutionMode;
  approvals: BuildApproval[];
  calls: BuildCall[];
  receipt_id?: string;
  warnings?: string[];
}

export interface SwapBuildRequest {
  token_in: string;
  token_out: string;
  amount_in: string;
  slippage_bps: number;
  taker_address?: string;
  user_address?: string;
  execution_mode?: ExecutionModeRequest;
  wallet_connected?: boolean;
}

export interface LpPreviewRequest {
  token0: string;
  token1: string;
  amount0: string;
  amount1: string;
  fee_tier: number;
  lower_tick?: number;
  upper_tick?: number;
  risk_profile?: RiskProfile;
}

export interface LpPreviewResponse {
  lower_tick: number;
  upper_tick: number;
  current_tick?: number | null;
  single_sided_expected?: boolean;
  single_sided_side?: "token0" | "token1" | "none" | string;
  estimated_share: string;
  estimated_fees_apr: number;
  warnings: string[];
}

export interface LpBuildRequest extends LpPreviewRequest {
  owner?: string;
  execution_mode?: ExecutionModeRequest;
  wallet_connected?: boolean;
}

export interface LpBuildResponse extends BuildTxResponse {
  position_id?: string;
  warnings?: string[];
}

export interface LpRemoveBuildRequest {
  owner: string;
  position_id: string;
  liquidity_bps: number;
  execution_mode?: ExecutionModeRequest;
  wallet_connected?: boolean;
}

export interface EkuboPosition {
  position_id: string;
  owner: string;
  token0: string;
  token1: string;
  ekubo_nft_id?: number;
  amount0: string;
  amount1: string;
  fee_tier: number;
  lower_tick: number;
  upper_tick: number;
  current_tick_at_build?: number | null;
  single_sided_expected?: boolean;
  single_sided_side?: "token0" | "token1" | "none" | string;
  status: string;
  created_at: string;
  updated_at: string;
  estimated_fees_apr?: number;
  estimated_share?: string;
}

export interface EkuboPositionsResponse {
  owner: string;
  positions: EkuboPosition[];
  count: number;
}

export interface EkuboCapabilities {
  chain_id?: string;
  router_address: string;
  positions_address: string;
  lp_enabled: boolean;
  market_surface_enabled: boolean;
  executor_live_submit_enabled: boolean;
  executor_can_submit_live: boolean;
  default_slippage_bps: number;
}

export interface VenueSnapshot {
  name: string;
  apy_pct: number;
  tvl_usd: number;
  volume_24h_usd: number;
}

export interface MarketOpportunity {
  pair: string;
  token0: string;
  token1: string;
  best_venue: string;
  spread_bps: number;
  change_24h_pct: number;
  tvl_usd: number;
  volume_24h_usd: number;
  estimated_apy_pct: number;
  reference_apy_pct: number;
  risk_score?: number;
  confidence: "low" | "medium" | "high" | string;
  route: string[];
  source?: "live" | "fallback" | "synthetic" | string;
  data_quality?: "live" | "fallback" | "synthetic" | string;
}

export interface MarketSurfaceResponse {
  timestamp: number;
  updated_at: string;
  source_timestamp: number;
  stale: boolean;
  summary: {
    best_pair?: string;
    best_venue?: string;
    top_spread_bps: number;
    opportunity_count: number;
    source?: string;
    data_quality?: string;
  };
  source?: string;
  data_quality?: string;
  venues: VenueSnapshot[];
  opportunities: MarketOpportunity[];
}

export interface TokenInfo {
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logo_url?: string;
  sort_order?: number;
}

export interface SessionKeyInfo {
  session_id: string;
  session_key: string;
  max_position: number;
  allowed_protocols: string[];
  duration_hours: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  is_expired: boolean;
  pending_grant?: boolean;
  pending_revoke?: boolean;
}

export interface SessionKeyListResponse {
  owner_address: string;
  sessions: SessionKeyInfo[];
  count: number;
  active_count: number;
}

export interface RiskPassportUser {
  composite_score: number;
  letter_rating: string;
  tier: number;
  tier_name: string;
  credit_tier?: string | null;
  credit_score?: number | null;
  proof_receipts?: Array<Record<string, unknown>>;
}

export interface RebalanceProposalResponse {
  proposal_id: string;
  user_address: string;
  from_protocol: number;
  to_protocol: number;
  amount: number;
  reason: string;
  status: string;
}

export interface RebalanceCheckResponse {
  proposal_id: string;
  can_proceed: boolean;
  risk_passed: boolean;
  anomaly_passed: boolean;
  commitment_hash?: string;
  snapshot_hash?: string;
  policy_allowed?: boolean;
}

export interface RebalancePrepareResponse {
  proposal_id: string;
  status: string;
  session_id: string;
  execution_proof_hash?: string;
  ready_to_execute: boolean;
}

export interface ExecutionPolicyDecision {
  enforceGate: boolean;
  advisoryAfterSubmit: boolean;
}

export type GasMode = "auto" | "wallet" | "paymaster";

/** Phase 1 control surface: execution intent for gate and signer requirements. */
export type ExecutionIntent = "manual_wallet" | "paymaster" | "orchestrated" | "autonomous";

export interface ExecutionInfraStatus {
  walletProvider: string;
  paymasterAvailable: boolean;
  gasMode: GasMode;
  controllerSession: string;
  fallbackUsed: boolean;
  lastFallbackReason?: string;
}

export interface AdvisoryCheckRequest {
  user_address: string;
  action_type: "swap" | "lp_add" | "lp_remove" | "deploy";
  pool_id: string;
  portfolio_features: number[];
  context?: {
    token_in?: string;
    token_out?: string;
    amount?: string;
    venue?: string;
    from_protocol?: number;
    to_protocol?: number;
  };
}

export interface AdvisoryCheckResponse {
  advisory_only: true;
  can_proceed: boolean;
  risk_passed: boolean;
  anomaly_passed: boolean;
  snapshot_hash?: string;
  commitment_hash?: string;
  reason?: string;
}

export interface ComplianceProfile {
  receipt_id: string;
  profile_type: string;
  verified: boolean;
  result: string;
  tx_hash?: string | null;
  proof_hash?: string | null;
  snapshot_hash?: string | null;
  created_at?: string | null;
  proof_type?: string;
}

export type PrivacyPreset = "custom" | "unlinkable_basic" | "hidden_flow" | "hashed_claims";
export type PrivacySettlementMode = "public_transfer" | "hashed_claim" | "internal_ledger";
export type PrivacyRelayMode = "none" | "optional" | "required";
export type ExecutionModePolicy = "manual_only" | "assist" | "autonomous";

export interface VaultPolicyProfile {
  profile_id: string;
  user_address: string;
  mode: "personal" | "shared_member";
  risk_budget: {
    max_drawdown_bps: number;
    max_daily_turnover_bps: number;
    max_position_pct: number;
  };
  strategy_permissions: {
    enable_dca: boolean;
    enable_lp: boolean;
    enable_rotation: boolean;
    enable_rebalance: boolean;
  };
  venue_allowlist: string[];
  token_allowlist: string[];
  execution_policy: {
    mode: ExecutionModePolicy;
    session_max_notional_usd: number;
    session_duration_hours: number;
    emergency_pause: boolean;
    cooldown_seconds: number;
  };
  disclosure_policy: {
    allow_balance_proof: boolean;
    allow_risk_proof: boolean;
    allow_performance_proof: boolean;
  };
  privacy_policy: {
    preset: PrivacyPreset;
    hide_amounts: boolean;
    hide_recipient: boolean;
    hide_sender: boolean;
    use_nullifier: boolean;
    settlement_mode: PrivacySettlementMode;
    relay_mode: PrivacyRelayMode;
    max_relayer_delay_seconds: number;
  };
  updated_at: string;
  shared_pool_context?: {
    shared_pool_id?: string;
    manager_address?: string;
  };
}

export interface SharedPoolEnvelopePolicy {
  shared_pool_id: string;
  manager_address: string;
  max_risk_budget: VaultPolicyProfile["risk_budget"];
  allowed_strategies: VaultPolicyProfile["strategy_permissions"];
  venue_allowlist: string[];
  token_allowlist: string[];
  privacy_floor: VaultPolicyProfile["privacy_policy"];
  execution_limits: {
    per_member_daily_notional_usd: number;
    min_passport_score: number;
  };
  updated_at: string;
}

export interface SharedPoolMemberPolicy {
  shared_pool_id: string;
  member_address: string;
  member_override: Partial<VaultPolicyProfile>;
  autopilot_opt_in: boolean;
  session_scope: {
    enabled: boolean;
    max_notional_usd: number;
    expires_at: string;
  };
  updated_at: string;
}

export type PrivacyExecutionPath = "shielded_pool" | "full_privacy_pool" | "hashed_withdraw_pool" | "internal_ledger";

export interface ExecutionCompileResponse {
  effective_policy_hash: string;
  execution_path: PrivacyExecutionPath;
  legacy_preset_label: "pool_a" | "pool_b" | "pool_c" | "pool_d" | "none";
  required_proofs: string[];
  requires_relayer: boolean;
  gate_required: boolean;
  advisory_only: boolean;
  can_execute: boolean;
  blocking_reasons: string[];
  warnings: string[];
}

export interface PolicyCompilePreviewResponse {
  path_label: PrivacyExecutionPath;
  required_proofs: string[];
  requires_relayer: boolean;
  estimated_steps: number;
  warnings: string[];
  can_execute: boolean;
  blocking_reasons: string[];
  effective_policy_hash: string;
  legacy_preset_label: "pool_a" | "pool_b" | "pool_c" | "pool_d" | "none";
  gate_required: boolean;
  advisory_only: boolean;
}

export interface SharedPoolRecord {
  shared_pool_id: string;
  manager_address: string;
  envelope: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  proposals?: Array<Record<string, unknown>>;
  members?: SharedPoolMemberPolicy[];
  updated_at?: string;
  created_at?: string;
}

export interface PrivacyUnifiedActionResponse {
  action: "deposit" | "withdraw";
  advisory_only: boolean;
  can_execute: boolean;
  path_label: PrivacyExecutionPath;
  required_proofs: string[];
  requires_relayer: boolean;
  warnings: string[];
  blocking_reasons: string[];
  legacy_preset_label: "pool_a" | "pool_b" | "pool_c" | "pool_d" | "none";
  effective_policy_hash: string;
  receipt_id: string;
  execution_ready: boolean;
  execution_mode?: ExecutionMode;
  approvals?: BuildApproval[];
  calls?: BuildCall[];
  withdraw_source?: "vault" | "ai_pool" | null;
}

export interface HistoryTimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  title: string;
  status: "pending" | "confirmed" | "failed" | "info";
  tx_hash?: string | null;
  receipt_id?: string | null;
  venue?: string | null;
  execution_path?: string | null;
  policy_hash?: string | null;
  details?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface HistoryTimelineResponse {
  user_address: string;
  events: HistoryTimelineEvent[];
  count: number;
}

export interface WalletStateToken {
  token: string;
  symbol: string;
  decimals: number;
  balance_raw?: string | null;
  balance?: string | null;
  allowance_raw?: string | null;
  allowance?: string | null;
  spender?: string | null;
  last_sync: string;
}

export interface WalletStateResponse {
  user_address: string;
  spender: string;
  last_sync: string;
  tokens: WalletStateToken[];
}

export interface ExecutionPreflightRequest {
  token_in: string;
  token_out: string;
  amount_in: string;
  slippage_bps: number;
  venue_pref?: "best" | "ekubo" | "avnu";
  user_address: string;
}

export interface ExecutionPreflightResponse {
  can_submit: boolean;
  max_safe_input_raw: string;
  expected_out_usd: number;
  impact_bps: number;
  warnings: string[];
  blocking_reasons: string[];
  liquidity_depth_usd?: number | null;
}

export interface WithdrawReadyEntry {
  id: string;
  execution_path: string;
  route_label: string;
  source: "local_commitment_import" | "manual_wallet_receipt";
  action_type: "deposit" | "withdraw";
  created_at: string;
  amount_wei: string;
  tx_hash?: string | null;
  title?: string | null;
  status: "pending" | "confirmed" | "failed" | "info";
  local_key?: string | null;
  has_local_commitment_data: boolean;
}

export interface WithdrawReadyRoute {
  execution_path: string;
  route_label: string;
  entry_count: number;
  local_commitment_count: number;
  estimated_withdrawable_amount_wei: string;
  missing_commitment_data_count: number;
  can_withdraw_direct: boolean;
  notes: string[];
}

export interface WithdrawReadyResponse {
  user_address: string;
  last_sync: string;
  routes: WithdrawReadyRoute[];
  entries: WithdrawReadyEntry[];
}

export interface CommitmentLedgerRoute {
  execution_path: string;
  route_label: string;
  source_keys: string[];
  entries: Array<Record<string, unknown>>;
}

export interface CommitmentLedgerResponse {
  user_address: string;
  last_sync: string;
  total_entries: number;
  routes: CommitmentLedgerRoute[];
}

// ── LP Recommendation ──

export interface LpRecommendationPool {
  pair: string;
  token0: string;
  token1: string;
  token0_symbol: string;
  token1_symbol: string;
  suggested_amount0: string;
  suggested_amount1: string;
  suggested_amount0_human: string;
  suggested_amount1_human: string;
  fee_tier: number;
  tvl_usd: number;
  estimated_apy_pct: number;
  confidence: string;
  reasoning: string;
}

export interface LpRecommendationResponse {
  recommendations: LpRecommendationPool[];
  summary: string;
  portfolio_context: string;
  generated_at: string;
  source: string;
  model: string | null;
}

/**
 * Strategies API client — yield, audit, rebalance, allocation.
 * Talks to /api/v1/strategies/* endpoints.
 */

import { API_BASE, apiFetch, walletAuthHeaders } from "@/lib/api/client";

/** Shorthand: call apiFetch with /api/v1/strategies prefix. */
function stratFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(`/api/v1/strategies${path}`, init);
}

// ── Yield ────────────────────────────────────────────────────────────────

export interface YieldPositionItem {
  position_id: string;
  pair: string;
  fees0_usd: number;
  fees1_usd: number;
  total_fees_usd: number;
  apr_est: number;
  status: string;
  harvest_tx: string | null;
  error: string | null;
  lower_tick?: number | null;
  upper_tick?: number | null;
  /** ISO-8601 position creation timestamp (when backend provides it). */
  created_at?: string | null;
}

export interface YieldSnapshotResponse {
  timestamp: string;
  owner: string;
  positions: YieldPositionItem[];
  total_fees_usd: number;
  total_positions: number;
  harvested_count: number;
}

export function getYieldSnapshot(ownerAddress: string): Promise<YieldSnapshotResponse> {
  return stratFetch<YieldSnapshotResponse>(`/yield/${encodeURIComponent(ownerAddress)}`);
}

// ── Audit ────────────────────────────────────────────────────────────────

export interface AuditAllocationItem {
  id: number;
  venue: string | null;
  pool_id: string | null;
  amount: string | null;
  metadata: string | null;
  status: string | null;
  allocated_at: number | null;
}

export interface AuditTrailResponse {
  user_address: string;
  allocations: AuditAllocationItem[];
  total_deployed_wei: number;
  total_yield_wei: number;
}

export function getAuditTrail(userAddress: string): Promise<AuditTrailResponse> {
  return stratFetch<AuditTrailResponse>(`/audit/${encodeURIComponent(userAddress)}`);
}

// ── Vault Summary ────────────────────────────────────────────────────────

export interface VaultSummaryResponse {
  user_address: string;
  total_deposited_wei: number;
  total_deployed_wei: number;
  total_yield_wei: number;
  total_withdrawn_wei: number;
  active_allocations: number;
  net_balance_wei: number;
}

export function getVaultSummary(userAddress: string): Promise<VaultSummaryResponse> {
  return stratFetch<VaultSummaryResponse>(`/vault-summary/${encodeURIComponent(userAddress)}`);
}

// ── Rebalance ────────────────────────────────────────────────────────────

export interface RebalanceActionItem {
  action: string;
  pool_id: string;
  pair: string;
  current_weight_pct: number;
  target_weight_pct: number;
  drift_pct: number;
  position_id: string | null;
  amount_usd: number;
  calldata: Record<string, unknown> | null;
}

export interface RebalancePlanResponse {
  timestamp: string;
  risk_profile: string;
  deposit_amount: number;
  drift_threshold_pct: number;
  max_drift_pct: number;
  needs_rebalance: boolean;
  actions: RebalanceActionItem[];
  new_attestation_hash: string;
}

export function getRebalancePlan(
  ownerAddress: string,
  riskProfile: string = "balanced",
): Promise<RebalancePlanResponse> {
  return stratFetch<RebalancePlanResponse>("/rebalance", {
    method: "POST",
    body: JSON.stringify({
      owner_address: ownerAddress,
      risk_profile: riskProfile,
    }),
  });
}

// ── Execute Allocation ───────────────────────────────────────────────────

export interface AllocatePoolItem {
  pool_id: string;
  protocol: string;
  pair: string;
  weight_pct: number;
  amount_usd: number;
  expected_apy_pct: number;
  risk_tier: string;
}

export interface ExecuteAllocationResponse {
  execution_id: string;
  attestation_hash: string;
  risk_profile: string;
  deposit_amount: number;
  results: Array<{
    pool_id: string;
    pair: string;
    position_id: string | null;
    status: string;
    tx_hash: string | null;
    amount_usd: number;
    error: string | null;
  }>;
  reserve_usd: number;
  live_submitted: boolean;
  allocation_summary: {
    allocations: AllocatePoolItem[];
    blended_apy_pct: number;
    source: string;
    attestation_hash: string;
  };
  timestamp: string;
}

export function executeAllocation(
  depositAmount: number,
  riskProfile: string,
  userAddress: string,
  demoMode?: boolean,
): Promise<ExecuteAllocationResponse> {
  const init: RequestInit = {
    method: "POST",
    body: JSON.stringify({
      deposit_amount: depositAmount,
      risk_profile: riskProfile,
      user_address: userAddress,
    }),
  };
  return apiFetch<ExecuteAllocationResponse>(
    "/api/v1/strategies/execute-allocation",
    init,
    demoMode ? { demoMode: true } : undefined,
  );
}

// ── User Constraints (from onboarding) ──────────────────────────────────

export interface UserConstraintsResponse {
  onboarded: boolean;
  risk_profile: string | null;
  risk_tolerance: number | null;
  max_position_usd: number | null;
  session_duration_hours: number | null;
  session_valid: boolean | null;
  identity_verified: boolean | null;
  fact_hash: string | null;
  claims: string[] | null;
}

export function getUserConstraints(
  userAddress: string,
): Promise<UserConstraintsResponse> {
  return stratFetch<UserConstraintsResponse>(
    `/user-constraints/${encodeURIComponent(userAddress)}`,
  );
}

// ── LLM Narration ───────────────────────────────────────────────────────

export type NarrationContextType =
  | "gate_evaluation"
  | "strategy_recommendation"
  | "idle_capital"
  | "gate_rate_explanation"
  | "error_decode"
  | "pending_claims";

export interface NarrationResponse {
  narration: string;
  source: "llm" | "deterministic" | "error";
  context_type?: string;
  cta?: { label: string; action: string };
}

export function fetchNarration(
  contextType: NarrationContextType,
  contextData: Record<string, unknown> = {},
): Promise<NarrationResponse> {
  return stratFetch<NarrationResponse>("/llm/narrate", {
    method: "POST",
    body: JSON.stringify({
      context_type: contextType,
      context_data: contextData,
    }),
  });
}

// ── Yield with Harvest ──────────────────────────────────────────────────

export function harvestYield(ownerAddress: string): Promise<YieldSnapshotResponse> {
  return stratFetch<YieldSnapshotResponse>(`/yield/${encodeURIComponent(ownerAddress)}?harvest=true`);
}

// ── Autonomous Agent ────────────────────────────────────────────────────

/** Shorthand: call apiFetch with /api/v1/zkdefi prefix. */
function zkdefiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(`/api/v1/zkdefi${path}`, init);
}

export interface AutoAgentStatus {
  state: "running" | "paused" | "stopped" | "error";
  user_address: string;
  running: boolean;
  interval_seconds?: number;
  actions_taken?: number;
  last_action?: string | null;
  errors?: string[];
  started_at?: string | null;
}

export function getAutoAgentStatus(userAddress: string): Promise<AutoAgentStatus> {
  return zkdefiFetch<AutoAgentStatus>(`/rebalancer/autonomous/status/${encodeURIComponent(userAddress)}`);
}

export function startAutoAgent(
  userAddress: string,
  sessionId: string,
  intervalMinutes: number = 15,
  riskThreshold: number = 50,
): Promise<AutoAgentStatus> {
  return zkdefiFetch<AutoAgentStatus>("/rebalancer/autonomous/start", {
    method: "POST",
    headers: walletAuthHeaders(userAddress),
    body: JSON.stringify({
      user_address: userAddress,
      session_id: sessionId,
      interval_minutes: intervalMinutes,
      risk_threshold: riskThreshold,
    }),
  });
}

export function stopAutoAgent(userAddress: string): Promise<AutoAgentStatus> {
  return zkdefiFetch<AutoAgentStatus>("/rebalancer/autonomous/stop", {
    method: "POST",
    headers: walletAuthHeaders(userAddress),
    body: JSON.stringify({ user_address: userAddress }),
  });
}

export function pauseAutoAgent(userAddress: string): Promise<AutoAgentStatus> {
  return zkdefiFetch<AutoAgentStatus>(`/rebalancer/autonomous/pause/${encodeURIComponent(userAddress)}`, {
    method: "POST",
    headers: walletAuthHeaders(userAddress),
  });
}

export function resumeAutoAgent(userAddress: string): Promise<AutoAgentStatus> {
  return zkdefiFetch<AutoAgentStatus>(`/rebalancer/autonomous/resume/${encodeURIComponent(userAddress)}`, {
    method: "POST",
    headers: walletAuthHeaders(userAddress),
  });
}

// ── Vault Policy ────────────────────────────────────────────────────────

export interface VaultPolicy {
  profile_id: string;
  user_address: string;
  mode: string;
  risk_budget: {
    max_drawdown_bps: number;
    max_daily_turnover_bps: number;
    max_position_pct: number;
  };
  strategy_permissions: {
    enable_dca: boolean;
    enable_lp: boolean;
    enable_rebalance: boolean;
    enable_rotation: boolean;
  };
  execution_policy: {
    mode: string;
    session_max_notional_usd: number;
    session_duration_hours: number;
    cooldown_seconds: number;
    emergency_pause: boolean;
  };
  privacy_policy: Record<string, unknown>;
  disclosure_policy: Record<string, unknown>;
  venue_allowlist: string[];
  token_allowlist: string[];
  updated_at: string;
}

export function getVaultPolicy(userAddress: string): Promise<VaultPolicy> {
  return zkdefiFetch<VaultPolicy>(`/policy/vault/${encodeURIComponent(userAddress)}`);
}

export function updateVaultPolicy(
  userAddress: string,
  patch: Record<string, unknown>,
): Promise<VaultPolicy> {
  return zkdefiFetch<VaultPolicy>(`/policy/vault/${encodeURIComponent(userAddress)}`, {
    method: "PUT",
    headers: walletAuthHeaders(userAddress),
    body: JSON.stringify({ patch }),
  });
}

// ── Recommend ────────────────────────────────────────────────────────────

export interface RecommendedPool {
  pool_id: string;
  protocol: string;
  pair: string;
  allocation_percent: number;
  allocation_amount: number;
  expected_apy: number;
  [key: string]: unknown;
}

export interface RecommendationResponse {
  recommendation_id: string;
  risk_profile: string;
  total_amount: number;
  recommended_pools: RecommendedPool[];
  [key: string]: unknown;
}

export function recommend(
  userAddress: string,
  riskProfile: string,
  amount: number,
): Promise<RecommendationResponse> {
  return stratFetch<RecommendationResponse>("/recommend", {
    method: "POST",
    body: JSON.stringify({
      user_address: userAddress,
      risk_profile: riskProfile,
      amount,
    }),
  });
}

// ── Execute Advanced ─────────────────────────────────────────────────────

export interface ExecuteAdvancedPosition {
  strategy?: string;
  pool_id?: string;
  amount?: number;
  tx_hash?: string | null;
  status?: string;
  pool_name?: string;
}

export interface ExecuteAdvancedResponse {
  positions: ExecuteAdvancedPosition[];
  [key: string]: unknown;
}

/**
 * Execute an advanced strategy deployment with v2 fallback.
 * Handles non-JSON backend responses gracefully.
 */
export async function executeAdvanced(
  body: Record<string, unknown>,
  demoMode?: boolean,
): Promise<ExecuteAdvancedResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(demoMode ? { "X-Demo-Mode": "true" } : {}),
  };
  let res = await fetch(`${API_BASE}/api/v1/strategies/execute-advanced`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    // Backward compatibility with older backend deployments.
    res = await fetch(`${API_BASE}/api/v2/strategies/execute-advanced`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      res.status === 404
        ? "Deploy endpoint not configured on this backend."
        : `Server returned non-JSON (${res.status}). Check API.`,
    );
  }
  if (!res.ok) {
    const detail =
      typeof json.detail === "string"
        ? json.detail
        : `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return json as unknown as ExecuteAdvancedResponse;
}

/**
 * Agents API client — model listing, agent CRUD, execution, provider health.
 * Talks to /api/v1/agents/* and /api/v1/zkdefi/agent-builder/* endpoints.
 */

import { apiFetch } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface AgentModel {
  id: string;
  name: string;
  description?: string;
  type: string;
  timeout: number;
}

export interface ModelsListResponse {
  models: AgentModel[];
}

export interface AgentSummary {
  agent_id: string;
  name: string;
  owner_address: string;
  identity_commitment: string;
  reputation_tier: number;
  bound_skills: string[];
  llm_provider_id: string;
  llm_model: string | null;
  active: boolean;
}

export interface AgentDetail extends AgentSummary {
  performance?: {
    avg_return_bps: number;
    total_executions: number;
    success_rate: number;
    sharpe_ratio: number;
    proof_verified_pct: number;
  };
  skills?: Array<{
    skill_id: string;
    name: string;
    circuit_id: string;
    available: boolean;
  }>;
}

export interface ExecuteGoalResponse {
  agent_id: string;
  goal: string;
  steps: Array<{
    step_type: string;
    skill_id: string | null;
    result: Record<string, unknown> | null;
    duration_ms: number;
    success: boolean;
  }>;
  final_decision: Record<string, unknown> | null;
  total_duration_ms: number;
  all_proofs_pass: boolean;
  llm_tokens_used: number;
  error: string | null;
  llm_provider_requested: string | null;
  llm_provider_used: string;
  llm_fallback_reason: string | null;
  reasoning_trace?: Array<{
    step_type: string;
    skill_id?: string | null;
    input_params?: Record<string, unknown> | null;
    result_summary?: Record<string, unknown> | null;
    duration_ms: number;
    success: boolean;
  }>;
}

export interface ProviderHealth {
  provider_id: string;
  status: "ok" | "error" | "unconfigured";
  latency_ms?: number;
  error?: string;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => String(row));
}

function toSkillIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (typeof row === "string") return row;
      if (row && typeof row === "object" && "skill_id" in row) {
        return String((row as { skill_id?: unknown }).skill_id ?? "");
      }
      return "";
    })
    .filter((row) => row.length > 0);
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAgentSummary(input: unknown): AgentSummary {
  const row = toRecord(input);
  const derivedSkills = toSkillIdArray(row.skills);
  const boundSkills = toSkillIdArray(row.bound_skills);
  return {
    agent_id: String(row.agent_id ?? row.id ?? ""),
    name: String(row.name ?? "Unnamed Agent"),
    owner_address: String(row.owner_address ?? row.owner ?? ""),
    identity_commitment: String(row.identity_commitment ?? "0"),
    reputation_tier: toNumber(row.reputation_tier, 0),
    bound_skills: boundSkills.length > 0 ? boundSkills : derivedSkills,
    llm_provider_id: String(row.llm_provider_id ?? row.llm_provider ?? "onyx"),
    llm_model: row.llm_model == null ? null : String(row.llm_model),
    active: typeof row.active === "boolean" ? row.active : true,
  };
}

function normalizeAgentDetail(input: unknown): AgentDetail {
  const row = toRecord(input);
  const base = normalizeAgentSummary(row);
  const perfRaw = toRecord(row.performance);
  const skillsRaw = Array.isArray(row.skills) ? row.skills : [];

  const performance =
    Object.keys(perfRaw).length > 0
      ? {
          avg_return_bps: toNumber(perfRaw.avg_return_bps ?? perfRaw.mean_return_bps, 0),
          total_executions: toNumber(perfRaw.total_executions ?? perfRaw.total_periods, 0),
          success_rate: toNumber(perfRaw.success_rate ?? perfRaw.win_rate, 0),
          sharpe_ratio: toNumber(perfRaw.sharpe_ratio, 0),
          proof_verified_pct: toNumber(perfRaw.proof_verified_pct, 0),
        }
      : undefined;

  const skills = skillsRaw.map((entry) => {
    const skill = toRecord(entry);
    return {
      skill_id: String(skill.skill_id ?? ""),
      name: String(skill.name ?? skill.skill_id ?? "Unknown"),
      circuit_id: String(skill.circuit_id ?? skill.circuit_name ?? "unknown"),
      available: typeof skill.available === "boolean" ? skill.available : true,
    };
  });

  return {
    ...base,
    bound_skills: base.bound_skills.length > 0 ? base.bound_skills : skills.map((s) => s.skill_id),
    performance,
    skills,
  };
}

function normalizeExecuteGoalResponse(input: unknown): ExecuteGoalResponse {
  const row = toRecord(input);
  const stepsRaw = Array.isArray(row.steps) ? row.steps : [];

  return {
    agent_id: String(row.agent_id ?? ""),
    goal: String(row.goal ?? ""),
    steps: stepsRaw.map((entry) => {
      const step = toRecord(entry);
      return {
        step_type: String(step.step_type ?? step.type ?? "unknown"),
        skill_id: step.skill_id == null ? null : String(step.skill_id),
        result: step.result && typeof step.result === "object" ? (step.result as Record<string, unknown>) : null,
        duration_ms: toNumber(step.duration_ms, 0),
        success: Boolean(step.success),
      };
    }),
    final_decision:
      row.final_decision && typeof row.final_decision === "object"
        ? (row.final_decision as Record<string, unknown>)
        : null,
    total_duration_ms: toNumber(row.total_duration_ms, 0),
    all_proofs_pass: Boolean(row.all_proofs_pass),
    llm_tokens_used: toNumber(row.llm_tokens_used ?? row.tokens_used, 0),
    error: row.error == null ? null : String(row.error),
    llm_provider_requested:
      row.llm_provider_requested == null ? null : String(row.llm_provider_requested),
    llm_provider_used: String(row.llm_provider_used ?? "unknown"),
    llm_fallback_reason: row.llm_fallback_reason == null ? null : String(row.llm_fallback_reason),
    reasoning_trace: Array.isArray(row.reasoning_trace)
      ? row.reasoning_trace.map((entry: unknown) => {
          const t = toRecord(entry);
          return {
            step_type: String(t.step_type ?? "unknown"),
            skill_id: t.skill_id == null ? null : String(t.skill_id),
            input_params: t.input_params && typeof t.input_params === "object" ? (t.input_params as Record<string, unknown>) : null,
            result_summary: t.result_summary && typeof t.result_summary === "object" ? (t.result_summary as Record<string, unknown>) : null,
            duration_ms: toNumber(t.duration_ms, 0),
            success: Boolean(t.success),
          };
        })
      : undefined,
  };
}

function normalizeProviderHealth(input: unknown): ProviderHealth {
  const row = toRecord(input);
  const rawStatus = String(row.status ?? "").toLowerCase();
  const status =
    rawStatus === "ok" || rawStatus === "healthy"
      ? "ok"
      : rawStatus === "unconfigured" || rawStatus === "no_credentials"
        ? "unconfigured"
        : "error";
  return {
    provider_id: String(row.provider_id ?? "unknown"),
    status,
    latency_ms: row.latency_ms == null ? undefined : toNumber(row.latency_ms, 0),
    error: row.error == null ? undefined : String(row.error),
  };
}

// ── API calls ────────────────────────────────────────────────────────────

export function listModels(): Promise<ModelsListResponse> {
  return apiFetch<ModelsListResponse>("/api/v1/agents/models/list");
}

export async function listAgents(owner?: string): Promise<{ agents: AgentSummary[]; count: number }> {
  const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
  const payload = await apiFetch<unknown>(`/api/v1/zkdefi/agent-builder/agents/list${q}`);
  const row = toRecord(payload);
  const agentsRaw = Array.isArray(row.agents) ? row.agents : [];
  const agents = agentsRaw.map((entry) => normalizeAgentSummary(entry));
  return {
    agents,
    count: toNumber(row.count, agents.length),
  };
}

export async function getAgent(agentId: string): Promise<AgentDetail> {
  const payload = await apiFetch<unknown>(`/api/v1/zkdefi/agent-builder/agents/${agentId}`);
  return normalizeAgentDetail(payload);
}

export async function executeGoal(
  agentId: string,
  goal: string,
  context?: Record<string, unknown>,
): Promise<ExecuteGoalResponse> {
  const payload = await apiFetch<unknown>(`/api/v1/zkdefi/agent-builder/agents/${agentId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, context }),
  });
  return normalizeExecuteGoalResponse(payload);
}

export function updateAgent(
  agentId: string,
  updates: Partial<{ name: string; skills: string[]; llm_provider: string; llm_model: string; active: boolean }>,
): Promise<{ status: string }> {
  return apiFetch(`/api/v1/zkdefi/agent-builder/agents/${agentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export function deleteAgent(agentId: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/zkdefi/agent-builder/agents/${agentId}`, {
    method: "DELETE",
  });
}

export async function getProviderHealth(): Promise<{ providers: ProviderHealth[] }> {
  const payload = await apiFetch<unknown>(`/api/v1/zkdefi/agent-builder/providers/health`);
  const row = toRecord(payload);
  const providers = (Array.isArray(row.providers) ? row.providers : []).map((entry) =>
    normalizeProviderHealth(entry),
  );
  return { providers };
}

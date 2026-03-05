"use client";

/**
 * AgentDashboard — Full agent management dashboard.
 *
 * Four views:
 *   1. Agent list (grid of cards with status + tier badge)
 *   2. Agent detail (skills, performance, on-chain tx link)
 *   3. Execute goal (input + live step display)
 *   4. Provider health (green/amber/red dots)
 *
 * Uses apiFetch via @/lib/api/agents and real-time toast feedback.
 */

import { useState, useEffect, useCallback } from "react";
import { ReasoningTrace } from "@/components/zkdefi/ReasoningTrace";
import {
  Brain,
  Bot,
  Zap,
  Shield,
  Trash2,
  Play,
  RefreshCw,
  ChevronLeft,
  ExternalLink,
  Loader2,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

import {
  listAgents,
  getAgent,
  executeGoal,
  deleteAgent,
  getProviderHealth,
  type AgentSummary,
  type AgentDetail,
  type ExecuteGoalResponse,
  type ProviderHealth,
} from "@/lib/api/agents";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";

// ── Helpers ──────────────────────────────────────────────────────────────

const TIER_LABELS = ["Unranked", "Bronze", "Silver", "Gold", "Diamond"];
const TIER_COLORS = [
  "text-zinc-400",
  "text-amber-600",
  "text-zinc-300",
  "text-yellow-400",
  "text-cyan-300",
];

const PROVIDER_LABELS: Record<string, string> = {
  openai_gpt: "OpenAI",
  onyx: "Onyx",
  clawbot: "Clawbot",
  local_llm: "Local LLM",
  deterministic: "Deterministic",
};

function prettyProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function humanizeFallbackReason(reason?: string | null): string | null {
  if (!reason) return null;
  if (reason.includes("missing_api_key:")) {
    const envVar = reason.split("missing_api_key:")[1];
    return `Missing API key (${envVar}).`;
  }
  if (reason.includes("endpoint_not_configured")) {
    return "Provider endpoint is not configured.";
  }
  if (reason.includes("openai_package_missing")) {
    return "Runtime dependency missing (`openai` package).";
  }
  if (reason.includes("client_init_failed")) {
    return "Provider client failed to initialize.";
  }
  if (reason.includes("provider_error:")) {
    return reason.replace(/^provider_error:[^:]*:?/, "Provider request failed: ");
  }
  if (reason.includes(":")) {
    const [from, detail] = reason.split(":", 2);
    return `${prettyProvider(from)} fallback: ${detail}`;
  }
  return reason;
}

function toStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const text = decodeEscapedText(value).trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return toStringList(parsed);
      }
    } catch {
      // ignore and continue with plain text split
    }
    return text
      .split(/\n+/)
      .map((entry) => entry.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") return JSON.stringify(entry);
      return String(entry ?? "");
    })
    .filter((entry) => entry.length > 0);
}

function stripCodeFence(text: string): string {
  const direct = text.trim();
  const fenced = direct.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  return fenced?.[1]?.trim() ?? direct;
}

function decodeEscapedText(text: string): string {
  const direct = text.trim();
  if (!direct) return "";
  try {
    const parsed = JSON.parse(direct);
    if (typeof parsed === "string") return parsed;
  } catch {
    // ignore
  }
  return direct
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (start < 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && start >= 0) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseEmbeddedJson(text: string, depth = 0): Record<string, unknown> | null {
  if (depth > 3) return null;
  const direct = stripCodeFence(decodeEscapedText(text));
  if (!direct) return null;
  try {
    const parsed = JSON.parse(direct);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed === "string") {
      return parseEmbeddedJson(parsed, depth + 1);
    }
  } catch {
    // ignore
  }

  const fragment = extractFirstJsonObject(direct);
  if (fragment) {
    try {
      const parsed = JSON.parse(fragment);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      if (typeof parsed === "string") {
        return parseEmbeddedJson(parsed, depth + 1);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

type DecisionView = {
  action: string | null;
  confidence: number | null;
  reasoning: string | null;
  verifiedClaims: string[];
  recommendations: string[];
  rawJson: Record<string, unknown>;
  rawText: string | null;
};

function normalizeDecisionView(input: Record<string, unknown> | null): DecisionView | null {
  if (!input) return null;
  let decision = input;
  let rawText: string | null = null;

  if (typeof decision.raw_response === "string") {
    rawText = decodeEscapedText(stripCodeFence(decision.raw_response));
    const parsed = parseEmbeddedJson(rawText);
    if (parsed) {
      decision = parsed;
    }
  }

  if (decision.final_decision && typeof decision.final_decision === "object" && !Array.isArray(decision.final_decision)) {
    decision = decision.final_decision as Record<string, unknown>;
  }
  if (decision.decision && typeof decision.decision === "object" && !Array.isArray(decision.decision)) {
    decision = decision.decision as Record<string, unknown>;
  }

  const actionCandidate = decision.action ?? decision.recommendation ?? decision.response ?? null;
  const reasoningCandidate = decision.reasoning ?? decision.rationale ?? decision.explanation ?? null;
  const confidenceCandidate = decision.confidence ?? decision.score ?? decision.probability ?? null;

  let confidence =
    typeof confidenceCandidate === "number"
      ? confidenceCandidate
      : typeof confidenceCandidate === "string"
        ? Number(confidenceCandidate)
        : null;
  if (typeof confidence === "number" && Number.isFinite(confidence) && confidence > 1 && confidence <= 100) {
    confidence = confidence / 100;
  }

  const reasoning =
    reasoningCandidate == null ? null : decodeEscapedText(String(reasoningCandidate));

  return {
    action: actionCandidate == null ? null : String(actionCandidate),
    confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
    reasoning,
    verifiedClaims: toStringList(decision.verified_claims ?? decision.claims ?? decision.proofs),
    recommendations: toStringList(decision.recommendations ?? decision.next_steps),
    rawJson: decision,
    rawText,
  };
}

function ProviderBadge({ provider, fallback }: { provider: string; fallback?: string | null }) {
  const dotColor = provider === "deterministic" ? "bg-amber-500" : "bg-emerald-500";
  const fallbackLabel = humanizeFallbackReason(fallback);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span className="text-zinc-400">{prettyProvider(provider)}</span>
      {fallbackLabel && (
        <span className="text-amber-400 text-[10px]">(fallback: {fallbackLabel})</span>
      )}
    </span>
  );
}

function HealthDot({ status }: { status: "ok" | "error" | "unconfigured" | "loading" }) {
  const color =
    status === "ok"
      ? "bg-emerald-500"
      : status === "unconfigured"
        ? "bg-amber-500"
        : status === "error"
          ? "bg-red-500"
          : "bg-zinc-500 animate-pulse";
  return <span className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

// ── Sub-views ────────────────────────────────────────────────────────────

type DashView = "list" | "detail" | "execute" | "health";

// ── Component ────────────────────────────────────────────────────────────

export function AgentDashboard({ address }: { address: string | undefined }) {
  const [view, setView] = useState<DashView>("list");
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null);
  const [execResult, setExecResult] = useState<ExecuteGoalResponse | null>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);

  // ── Load agents ───────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAgents(address);
      setAgents(res.agents ?? []);
    } catch (err) {
      toastError("Failed to load agents");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // ── Select agent ──────────────────────────────────────────────────────
  const openAgent = useCallback(async (agentId: string) => {
    try {
      const detail = await getAgent(agentId);
      setSelectedAgent(detail);
      setView("detail");
    } catch {
      toastError("Failed to load agent details");
    }
  }, []);

  // ── Delete agent ──────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (agentId: string) => {
      if (!confirm("Delete this agent? This cannot be undone.")) return;
      try {
        await deleteAgent(agentId);
        toastSuccess("Agent deleted");
        setView("list");
        fetchAgents();
      } catch {
        toastError("Failed to delete agent");
      }
    },
    [fetchAgents],
  );

  // ── Execute goal ──────────────────────────────────────────────────────
  const handleExecute = useCallback(async () => {
    if (!selectedAgent || !goalInput.trim()) return;
    setExecLoading(true);
    setExecResult(null);
    toastInfo(`Executing: "${goalInput.slice(0, 60)}…"`);
    try {
      const res = await executeGoal(selectedAgent.agent_id, goalInput);
      setExecResult(res);
      const stepCount = Array.isArray(res.steps) ? res.steps.length : 0;
      if (res.all_proofs_pass) {
        toastSuccess(`Goal completed — ${stepCount} steps, all proofs passed`);
      } else if (res.error) {
        toastError(`Execution error: ${res.error}`);
      } else {
        toastInfo(`Goal completed — ${stepCount} steps`);
      }
    } catch (err) {
      toastError("Execution failed");
      console.error(err);
    } finally {
      setExecLoading(false);
    }
  }, [selectedAgent, goalInput]);

  // ── Provider health ───────────────────────────────────────────────────
  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await getProviderHealth();
      setProviders(res.providers ?? []);
    } catch {
      toastError("Failed to fetch provider health");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // ────────────────────────────────────────────────────────────────────────
  // VIEW: Agent List
  // ────────────────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-400" /> My Agents
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => { fetchHealth(); setView("health"); }}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 flex items-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" /> Provider Health
            </button>
            <button
              onClick={fetchAgents}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {loading && agents.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        )}

        {!loading && agents.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            <Bot className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              No agents yet. Build one in the <strong>Identity Agents</strong> tab.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <button
              key={agent.agent_id}
              onClick={() => openAgent(agent.agent_id)}
              className="glass rounded-xl border border-zinc-800 p-4 text-left hover:border-emerald-700/50 transition-all group"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-zinc-200 group-hover:text-emerald-300 transition-colors">
                    {agent.name}
                  </h3>
                  <span className="text-xs text-zinc-500 font-mono">
                    {agent.agent_id}
                  </span>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    agent.active
                      ? "bg-emerald-600/20 text-emerald-400"
                      : "bg-zinc-700 text-zinc-400"
                  }`}
                >
                  {agent.active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-400 mt-2">
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  <span className={TIER_COLORS[agent.reputation_tier] ?? TIER_COLORS[0]}>
                    {TIER_LABELS[agent.reputation_tier] ?? "T" + agent.reputation_tier}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {(agent.bound_skills?.length ?? 0)} skills
                </span>
                <ProviderBadge provider={agent.llm_provider_id} />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // VIEW: Agent Detail
  // ────────────────────────────────────────────────────────────────────────
  if (view === "detail" && selectedAgent) {
    const decisionView = normalizeDecisionView(execResult?.final_decision ?? null);
    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => { setView("list"); setExecResult(null); }}
            className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={() => handleDelete(selectedAgent.agent_id)}
            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>

        {/* Agent card */}
        <div className="glass rounded-xl border border-zinc-800 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-zinc-100">{selectedAgent.name}</h2>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">{selectedAgent.agent_id}</p>
            </div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                selectedAgent.active
                  ? "bg-emerald-600/20 text-emerald-400"
                  : "bg-zinc-700 text-zinc-400"
              }`}
            >
              {selectedAgent.active ? "Active" : "Inactive"}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-zinc-500 text-xs">Tier</span>
              <p className={`font-semibold ${TIER_COLORS[selectedAgent.reputation_tier] ?? TIER_COLORS[0]}`}>
                {TIER_LABELS[selectedAgent.reputation_tier] ?? "T" + selectedAgent.reputation_tier}
              </p>
            </div>
            <div>
              <span className="text-zinc-500 text-xs">Skills</span>
              <p className="font-semibold text-zinc-200">{selectedAgent.bound_skills?.length ?? 0}</p>
            </div>
            <div>
              <span className="text-zinc-500 text-xs">Provider</span>
              <ProviderBadge provider={selectedAgent.llm_provider_id} />
            </div>
            <div>
              <span className="text-zinc-500 text-xs">Model</span>
              <p className="font-semibold text-zinc-200">{selectedAgent.llm_model ?? "—"}</p>
            </div>
          </div>

          {/* Skills list */}
          {selectedAgent.skills && selectedAgent.skills.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs text-zinc-500 mb-2">Bound Skills</h4>
              <div className="flex flex-wrap gap-2">
                {selectedAgent.skills.map((s) => (
                  <span
                    key={s.skill_id}
                    className={`px-2 py-0.5 text-xs rounded-full border ${
                      s.available
                        ? "border-emerald-700/40 bg-emerald-950/20 text-emerald-400"
                        : "border-zinc-700 bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Performance */}
          {selectedAgent.performance && (
            <div className="mt-4 grid grid-cols-3 md:grid-cols-5 gap-3 text-xs">
              <div>
                <span className="text-zinc-500">Avg Return</span>
                <p className="font-semibold text-zinc-200">
                  {(selectedAgent.performance.avg_return_bps / 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <span className="text-zinc-500">Executions</span>
                <p className="font-semibold text-zinc-200">
                  {selectedAgent.performance.total_executions}
                </p>
              </div>
              <div>
                <span className="text-zinc-500">Success Rate</span>
                <p className="font-semibold text-zinc-200">
                  {(selectedAgent.performance.success_rate * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <span className="text-zinc-500">Sharpe</span>
                <p className="font-semibold text-zinc-200">
                  {selectedAgent.performance.sharpe_ratio.toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-zinc-500">Proofs Verified</span>
                <p className="font-semibold text-zinc-200">
                  {(selectedAgent.performance.proof_verified_pct * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Execute goal */}
        <div className="glass rounded-xl border border-zinc-800 p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <Play className="w-4 h-4 text-emerald-400" /> Execute Goal
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="e.g. Optimize portfolio yield for low-risk profile"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600"
              onKeyDown={(e) => e.key === "Enter" && handleExecute()}
            />
            <button
              onClick={handleExecute}
              disabled={execLoading || !goalInput.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg flex items-center gap-1.5 transition-colors"
            >
              {execLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              Run
            </button>
          </div>

          {/* Execution result */}
          {execResult && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 text-sm">
                {execResult.all_proofs_pass ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : execResult.error ? (
                  <XCircle className="w-4 h-4 text-red-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                )}
                <span className="text-zinc-300">
                  {(execResult.steps?.length ?? 0)} steps in {execResult.total_duration_ms}ms
                </span>
                {execResult.llm_provider_requested && (
                  <span className="text-zinc-500 text-xs">
                    requested: {prettyProvider(execResult.llm_provider_requested)}
                  </span>
                )}
                <ProviderBadge
                  provider={execResult.llm_provider_used}
                  fallback={execResult.llm_fallback_reason}
                />
              </div>

              {/* Steps timeline — use rich ReasoningTrace when available */}
              {execResult.reasoning_trace && execResult.reasoning_trace.length > 0 ? (
                <ReasoningTrace
                  steps={execResult.reasoning_trace}
                  llmProviderUsed={execResult.llm_provider_used}
                  llmTokensUsed={execResult.llm_tokens_used}
                  llmFallbackReason={execResult.llm_fallback_reason}
                  totalTimeMs={execResult.total_duration_ms}
                />
              ) : (
              <div className="space-y-2">
                {(Array.isArray(execResult.steps) ? execResult.steps : []).map((step, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg ${
                      step.success ? "bg-emerald-950/20 border border-emerald-700/20" : "bg-red-950/20 border border-red-700/20"
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400">
                      {i + 1}
                    </span>
                    <span className="font-medium text-zinc-300">{step.step_type}</span>
                    {step.skill_id && (
                      <span className="text-zinc-500">{step.skill_id}</span>
                    )}
                    <span className="ml-auto text-zinc-500">{step.duration_ms}ms</span>
                    {step.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    )}
                  </div>
                ))}
              </div>
              )}

              {/* Final decision */}
              {decisionView && (
                <div className="bg-zinc-900 rounded-lg p-3 text-xs">
                  <h4 className="text-zinc-400 mb-1 font-semibold">Final Decision</h4>
                  <div className="space-y-2 text-zinc-300">
                    {decisionView.action && (
                      <div>
                        <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Action</p>
                        <p className="text-zinc-100 text-sm">{decisionView.action}</p>
                      </div>
                    )}
                    {typeof decisionView.confidence === "number" && (
                      <div>
                        <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Confidence</p>
                        <p>{(decisionView.confidence * 100).toFixed(1)}%</p>
                      </div>
                    )}
                    {decisionView.reasoning && (
                      <div>
                        <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Reasoning</p>
                        <p className="whitespace-pre-wrap">{decisionView.reasoning}</p>
                      </div>
                    )}
                    {decisionView.verifiedClaims.length > 0 && (
                      <div>
                        <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Verified Claims</p>
                        <ul className="list-disc pl-4 space-y-1">
                          {decisionView.verifiedClaims.map((claim, idx) => (
                            <li key={idx}>{claim}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {decisionView.recommendations.length > 0 && (
                      <div>
                        <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Recommendations</p>
                        <ul className="list-disc pl-4 space-y-1">
                          {decisionView.recommendations.map((rec, idx) => (
                            <li key={idx}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {decisionView.rawText && (
                      <details className="pt-1">
                        <summary className="cursor-pointer text-zinc-500">Raw model text</summary>
                        <pre className="mt-1 whitespace-pre-wrap overflow-x-auto max-h-40 text-zinc-400">
                          {decisionView.rawText}
                        </pre>
                      </details>
                    )}
                    <details className="pt-1">
                      <summary className="cursor-pointer text-zinc-500">Raw JSON</summary>
                      <pre className="mt-1 whitespace-pre-wrap overflow-x-auto max-h-40 text-zinc-400">
                        {JSON.stringify(decisionView.rawJson, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // VIEW: Provider Health
  // ────────────────────────────────────────────────────────────────────────
  if (view === "health") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("list")}
            className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={fetchHealth}
            disabled={healthLoading}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyan-400" /> LLM Provider Health
        </h2>

        {healthLoading && providers.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        )}

        <div className="space-y-2">
          {providers.map((p) => (
            <div
              key={p.provider_id}
              className="flex items-center justify-between glass rounded-lg border border-zinc-800 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <HealthDot status={p.status} />
                <span className="text-sm font-medium text-zinc-200">{prettyProvider(p.provider_id)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-400">
                {p.latency_ms !== undefined && <span>{p.latency_ms}ms</span>}
                {p.error && (
                  <span className={p.status === "unconfigured" ? "text-amber-400" : "text-red-400"}>
                    {humanizeFallbackReason(p.error) ?? p.error}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full font-medium ${
                    p.status === "ok"
                      ? "bg-emerald-600/20 text-emerald-400"
                      : p.status === "unconfigured"
                        ? "bg-amber-600/20 text-amber-400"
                        : "bg-red-600/20 text-red-400"
                  }`}
                >
                  {p.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Fallback
  return null;
}

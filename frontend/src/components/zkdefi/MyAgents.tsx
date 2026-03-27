"use client";

import { useState, useEffect } from "react";
import { Brain, Play, Trash2, Check, X, Clock, Zap } from "lucide-react";
import {
  apiFetch,
  getApiErrorMessage,
  getTrustGateErrorDetail,
} from "@/lib/api/client";

interface Agent {
  id: string;
  name: string;
  processors: string[];
  decision_logic: { type: "AND" | "OR" };
  llm?: {
    provider?: string;
    model?: string;
  };
  active: boolean;
  created_at: number;
}

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toDecisionType = (value: unknown): "AND" | "OR" => {
  return value === "OR" ? "OR" : "AND";
};

const toTimestamp = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
};

const normalizeAgent = (value: unknown, index: number): Agent | null => {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const llmRecord = toRecord(record.llm);
  const decisionLogicRecord = toRecord(record.decision_logic);
  const processors = Array.isArray(record.processors)
    ? record.processors.filter((p): p is string => typeof p === "string")
    : [];

  const rawId = typeof record.id === "string" && record.id.trim() ? record.id : `agent-${index}`;
  const rawName = typeof record.name === "string" && record.name.trim() ? record.name : "Unnamed Agent";

  return {
    id: rawId,
    name: rawName,
    processors,
    decision_logic: {
      type: toDecisionType(decisionLogicRecord?.type),
    },
    llm: llmRecord
      ? {
          provider: typeof llmRecord.provider === "string" ? llmRecord.provider : undefined,
          model: typeof llmRecord.model === "string" ? llmRecord.model : undefined,
        }
      : undefined,
    active: Boolean(record.active),
    created_at: toTimestamp(record.created_at),
  };
};

interface ProcessorResult {
  processor_id: string;
  passed: boolean;
  score: number | null;
  threshold: number | null;
  has_proof: boolean;
  error: string | null;
  execution_time_ms: number;
}

interface ExecutionResult {
  agent_id: string;
  agent_name: string;
  should_execute: boolean;
  decision_logic: string;
  processor_results: ProcessorResult[];
  execution_calldata: string[] | null;
  total_time_ms: number;
  gate_context?: {
    source?: string;
    requires_lending_gate?: boolean;
    execution?: {
      mode?: string;
      reason_codes?: string[];
      reason_hints?: string[];
    };
    lending?: {
      mode?: string;
      reason_codes?: string[];
      reason_hints?: string[];
    } | null;
  };
}

export function MyAgents({
  userAddress,
  refreshTrigger,
  highlightAgentId,
}: {
  userAddress: string;
  refreshTrigger?: number;
  highlightAgentId?: string | null;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [gateError, setGateError] = useState<ReturnType<typeof getTrustGateErrorDetail>>(null);

  useEffect(() => {
    fetchAgents();
  }, [userAddress, refreshTrigger]);

  const fetchAgents = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await apiFetch<{ agents?: unknown[] }>(`/api/v1/agents/user/${userAddress}`);
      const normalizedAgents = (Array.isArray(data.agents) ? data.agents : [])
        .map((agent, index) => normalizeAgent(agent, index))
        .filter((agent): agent is Agent => agent !== null);
      setAgents(normalizedAgents);
    } catch (e) {
      console.error("Failed to fetch agents:", e);
      setFetchError(e instanceof Error ? e.message : "Failed to fetch agents");
    }
    setLoading(false);
  };

  const executeAgent = async (agentId: string) => {
    setExecutingId(agentId);
    setExecutionResult(null);
    setExecutionError(null);
    setGateError(null);
    try {
      // Fetch real portfolio from vault status API
      let portfolio: Record<string, unknown> = {
        assets: { eth: 0, usdc: 0, strk: 0 },
        daily_positions: [],
        volatility: 0,
        liquidity: 0,
      };
      try {
        const vaultData = await apiFetch<{
          deployed_wei?: string;
          total_yield_wei?: string;
          allocations?: Array<{ protocol?: string; amount_wei?: string }>;
        }>(`/api/v1/zkdefi/vault/status?user_address=${userAddress}`);
        const deployedStrk = Number(vaultData.deployed_wei ?? "0") / 1e18;
        portfolio = {
          assets: { strk: Math.round(deployedStrk), eth: 0, usdc: 0 },
          daily_positions: [],
          volatility: 30,
          liquidity: 70,
        };
      } catch {
        // Use empty portfolio if vault data unavailable
      }

      const result = await apiFetch<ExecutionResult>(`/api/v1/agents/${agentId}/execute`, {
        method: "POST",
        body: JSON.stringify({
          user_address: userAddress,
          portfolio,
          constraints: {
            max_risk: 100,
            max_correlation: 90,
            max_twap: 50000,
            min_diversification: 30,
            min_credit: 400,
          },
        }),
      });
      setExecutionResult(result);
    } catch (e) {
      console.error("Execution error:", e);
      setGateError(getTrustGateErrorDetail(e));
      setExecutionError(getApiErrorMessage(e));
    }
    setExecutingId(null);
  };

  const deactivateAgent = async (agentId: string) => {
    try {
      await apiFetch(`/api/v1/agents/${agentId}?user_address=${userAddress}`, {
        method: "DELETE",
      });
      fetchAgents();
    } catch (e) {
      console.error("Failed to deactivate:", e);
    }
  };

  const formatDate = (ts: number) => {
    const millis = ts > 1_000_000_000_000 ? ts : ts * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-400" />
          My Agents
        </h3>
        <div className="text-center py-8 text-zinc-500">Loading agents...</div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl border border-zinc-800 p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <Brain className="w-5 h-5 text-violet-400" />
        My Agents
        <span className="ml-auto text-xs text-zinc-500">{agents.length} agents</span>
      </h3>

      {agents.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <Brain className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No agents created yet</p>
          <p className="text-xs">Compose your first agent above</p>
          {fetchError && <p className="mt-2 text-xs text-red-400">{fetchError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`p-4 rounded-lg border transition-all ${
                highlightAgentId === agent.id
                  ? "bg-emerald-900/20 border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.4)]"
                  : agent.active
                    ? "bg-zinc-800/50 border-zinc-700"
                    : "bg-zinc-900/50 border-zinc-800 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      agent.active ? "bg-emerald-500" : "bg-zinc-600"
                    }`}
                  />
                  <span className="font-medium">{agent.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {agent.active && (
                    <button
                      onClick={() => executeAgent(agent.id)}
                      disabled={executingId === agent.id}
                      className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-all"
                      title="Execute Agent"
                    >
                      {executingId === agent.id ? (
                        <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => deactivateAgent(agent.id)}
                    className="p-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-all"
                    title="Deactivate"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-2">
                {agent.processors.map((p) => (
                  <span
                    key={p}
                    className="px-2 py-0.5 text-xs rounded bg-violet-600/20 text-violet-300 border border-violet-600/30"
                  >
                    {p.replace(/_/g, " ")}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <span>
                  Logic:{" "}
                  <span
                    className={
                      agent.decision_logic.type === "AND" ? "text-emerald-400" : "text-orange-400"
                    }
                  >
                    {agent.decision_logic.type}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(agent.created_at)}
                </span>
                {agent.llm?.provider && (
                  <span className="text-zinc-400">
                    LLM: <span className="text-violet-300">{agent.llm.provider}</span>
                    {agent.llm.model ? `/${agent.llm.model}` : ""}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Execution Result */}
      {executionResult && (
        <div className="mt-4 p-4 rounded-lg bg-zinc-800/80 border border-zinc-700">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-sm">Execution Result: {executionResult.agent_name}</h4>
            <button onClick={() => setExecutionResult(null)} className="text-zinc-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className={`p-3 rounded-lg mb-3 ${
              executionResult.should_execute
                ? "bg-emerald-900/20 border border-emerald-800"
                : "bg-red-900/20 border border-red-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {executionResult.should_execute ? (
                <Check className="w-5 h-5 text-emerald-400" />
              ) : (
                <X className="w-5 h-5 text-red-400" />
              )}
              <span className={executionResult.should_execute ? "text-emerald-300" : "text-red-300"}>
                {executionResult.should_execute ? "Agent approved execution" : "Execution blocked"}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-zinc-400">Processor Results ({executionResult.decision_logic} logic):</p>
            {executionResult.processor_results.map((pr) => (
              <div
                key={pr.processor_id}
                className={`p-2 rounded border text-sm ${
                  pr.passed
                    ? "bg-emerald-900/10 border-emerald-800/50 text-emerald-300"
                    : "bg-red-900/10 border-red-800/50 text-red-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    {pr.passed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {pr.processor_id.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-zinc-500">{pr.execution_time_ms}ms</span>
                </div>
                {pr.score !== null && (
                  <p className="text-xs mt-1 text-zinc-400">
                    Score: <span className={pr.passed ? "text-emerald-400" : "text-red-400"}>{pr.score}</span>
                    {pr.threshold !== null && <span> / {pr.threshold} threshold</span>}
                  </p>
                )}
                {pr.has_proof && (
                  <span className="inline-block mt-1 px-1.5 py-0.5 text-xs bg-cyan-600/20 text-cyan-400 rounded">
                    zkProof
                  </span>
                )}
              </div>
            ))}
          </div>

          {executionResult.execution_calldata && executionResult.execution_calldata.length > 0 && (
            <div className="mt-3 p-2 rounded bg-zinc-700/50 text-xs">
              <span className="text-zinc-400">Execution Calldata: </span>
              <code className="text-cyan-400 break-all">[{executionResult.execution_calldata.slice(0, 5).join(", ")}...]</code>
            </div>
          )}

          <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Total time: {executionResult.total_time_ms}ms
          </p>
        </div>
      )}

      {!executionResult && executionError && (
        <div className="mt-4 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-sm text-red-200">Execution blocked</h4>
            <button onClick={() => { setExecutionError(null); setGateError(null); }} className="text-zinc-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-red-100">{executionError}</p>
          {gateError?.gate && (
            <p className="mt-1 text-xs text-red-200/80">
              Gate: {gateError.gate}{gateError.source ? ` · ${gateError.source}` : ""}
            </p>
          )}
          {Array.isArray(gateError?.decision?.reason_hints) && gateError.decision.reason_hints.length > 0 ? (
            <div className="mt-3 space-y-1">
              {gateError.decision.reason_hints.map((hint) => (
                <p key={hint} className="text-xs text-red-100/90">• {hint}</p>
              ))}
            </div>
          ) : Array.isArray(gateError?.decision?.reason_codes) && gateError.decision.reason_codes.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {gateError.decision.reason_codes.map((code) => (
                <span
                  key={code}
                  className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-100"
                >
                  {code}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

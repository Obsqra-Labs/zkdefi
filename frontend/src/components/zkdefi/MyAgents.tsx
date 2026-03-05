"use client";

import { useState, useEffect } from "react";
import { Brain, Play, Pause, Trash2, Check, X, Clock, Zap, ExternalLink } from "lucide-react";

import { API_BASE, walletAuthHeaders } from "@/lib/api/client";

interface Agent {
  id: string;
  name: string;
  processors: string[];
  decision_logic: { type: "AND" | "OR" };
  active: boolean;
  created_at: number;
}

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
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAgent(input: unknown): Agent {
  const row = toRecord(input);
  const decisionLogic = toRecord(row.decision_logic);
  return {
    id: String(row.id ?? row.agent_id ?? ""),
    name: String(row.name ?? "Unnamed Agent"),
    processors: Array.isArray(row.processors) ? row.processors.map((p) => String(p)) : [],
    decision_logic: {
      type: decisionLogic.type === "OR" ? "OR" : "AND",
    },
    active: typeof row.active === "boolean" ? row.active : true,
    created_at: toNumber(row.created_at, Math.floor(Date.now() / 1000)),
  };
}

function normalizeProcessorResult(input: unknown): ProcessorResult {
  const row = toRecord(input);
  const score = row.score == null ? null : toNumber(row.score, 0);
  const threshold = row.threshold == null ? null : toNumber(row.threshold, 0);
  return {
    processor_id: String(row.processor_id ?? "unknown_processor"),
    passed: Boolean(row.passed),
    score,
    threshold,
    has_proof: Boolean(row.has_proof),
    error: row.error == null ? null : String(row.error),
    execution_time_ms: toNumber(row.execution_time_ms, 0),
  };
}

function normalizeExecutionResult(input: unknown): ExecutionResult {
  const row = toRecord(input);
  return {
    agent_id: String(row.agent_id ?? ""),
    agent_name: String(row.agent_name ?? row.name ?? "Agent"),
    should_execute: Boolean(row.should_execute),
    decision_logic: String(row.decision_logic ?? "AND"),
    processor_results: Array.isArray(row.processor_results)
      ? row.processor_results.map((entry) => normalizeProcessorResult(entry))
      : [],
    execution_calldata: Array.isArray(row.execution_calldata)
      ? row.execution_calldata.map((item) => String(item))
      : null,
    total_time_ms: toNumber(row.total_time_ms, 0),
  };
}

export function MyAgents({
  userAddress,
  refreshTrigger,
}: {
  userAddress: string;
  refreshTrigger?: number;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);

  useEffect(() => {
    fetchAgents();
  }, [userAddress, refreshTrigger]);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/agents/user/${userAddress}`);
      if (res.ok) {
        const data = toRecord(await res.json());
        const rows = Array.isArray(data.agents) ? data.agents : [];
        setAgents(rows.map((entry) => normalizeAgent(entry)));
      } else {
        setAgents([]);
      }
    } catch (e) {
      console.error("Failed to fetch agents:", e);
      setAgents([]);
    }
    setLoading(false);
  };

  const executeAgent = async (agentId: string) => {
    setExecutingId(agentId);
    setExecutionResult(null);
    try {
      // Use path-based execute endpoint (new local orchestrator API)
      const res = await fetch(`${API_BASE}/api/v1/agents/${agentId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: userAddress,
          portfolio: {
            assets: { eth: 50000, usdc: 30000, strk: 20000 },
            daily_positions: [10000, 11000, 10500, 12000, 11500, 13000, 12500],
            volatility: 30,
            liquidity: 70,
          },
          constraints: {
            max_risk: 100,
            max_correlation: 90,
            max_twap: 50000,
            min_diversification: 30,
            min_credit: 400,
          },
        }),
      });

      if (res.ok) {
        const result = normalizeExecutionResult(await res.json());
        setExecutionResult(result);
      } else {
        const data = await res.json();
        console.error("Execution failed:", data);
      }
    } catch (e) {
      console.error("Network error:", e);
    }
    setExecutingId(null);
  };

  const deactivateAgent = async (agentId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/agents/${agentId}?user_address=${userAddress}`, {
        method: "DELETE",
        headers: walletAuthHeaders(userAddress),
      });
      if (res.ok) {
        fetchAgents();
      }
    } catch (e) {
      console.error("Failed to deactivate:", e);
    }
  };

  const formatDate = (ts: number) => new Date(ts * 1000).toLocaleDateString();

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
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`p-4 rounded-lg border transition-all ${
                agent.active
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
    </div>
  );
}

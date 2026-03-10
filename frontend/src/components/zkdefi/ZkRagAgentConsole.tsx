"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, Loader2, Play, RefreshCw, Shield } from "lucide-react";

import { API_BASE } from "@/lib/api/client";

type ScanMode = "signal" | "gate";

interface CapabilityCircuit {
  name: string;
  category: string;
  ready: boolean;
}

interface CapabilityProvider {
  provider_id: string;
  available: boolean;
}

interface CapabilitySnapshot {
  circuits_total: number;
  circuits_ready: number;
  circuits: CapabilityCircuit[];
  skills_total: number;
  skills_ready: number;
  llm_providers: CapabilityProvider[];
}

interface AgentQueryRow {
  query: string;
  available: boolean;
  results: number;
  fact_hash?: string | null;
}

interface AgentReport {
  prompt: string;
  confidence: number;
  duration_ms: number;
  query_plan: string[];
  zkrag_queries: AgentQueryRow[];
  synthesis?: {
    summary?: string;
    provider?: string;
    model?: string;
  };
  circuits?: {
    ready?: number;
    total?: number;
    live_scan?: {
      all_pass?: boolean;
      summary?: {
        compliant?: number;
        non_compliant?: number;
        failed?: number;
        skipped?: number;
      };
    } | null;
  };
}

interface ZkRagAgentConsoleProps {
  userAddress?: string;
  onReceiptCreated?: () => void;
}

export function ZkRagAgentConsole({ userAddress, onReceiptCreated }: ZkRagAgentConsoleProps) {
  const [capabilities, setCapabilities] = useState<CapabilitySnapshot | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AgentReport | null>(null);

  const [prompt, setPrompt] = useState("show settlement + reputation risk posture for this wallet and highlight any failing execution constraints");
  const [poolId, setPoolId] = useState("ekubo_eth_usdc");
  const [strategyId, setStrategyId] = useState("default_strategy");
  const [runLiveCircuits, setRunLiveCircuits] = useState(true);
  const [llmSynthesis, setLlmSynthesis] = useState(true);
  const [scanMode, setScanMode] = useState<ScanMode>("signal");
  const [selectedCircuits, setSelectedCircuits] = useState<string[]>([
    "RiskPassportTier",
    "ExecutionIntegrity",
    "SolvencyProof",
  ]);

  const readyCircuits = useMemo(
    () => (capabilities?.circuits || []).filter((c) => c.ready).map((c) => c.name),
    [capabilities],
  );

  const availableProviders = useMemo(
    () => (capabilities?.llm_providers || []).filter((p) => p.available).map((p) => p.provider_id),
    [capabilities],
  );

  const fetchCapabilities = useCallback(async () => {
    setLoadingCapabilities(true);
    try {
      const res = await fetch(`${API_BASE}/v1/zkdefi/zkgraph/agent/capabilities`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Capabilities request failed (${res.status})`);
      const data = (await res.json()) as CapabilitySnapshot;
      setCapabilities(data);
      setError(null);
      setSelectedCircuits((prev) => prev.filter((name) => (data.circuits || []).some((c) => c.name === name && c.ready)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load capability snapshot");
    } finally {
      setLoadingCapabilities(false);
    }
  }, []);

  useEffect(() => {
    fetchCapabilities();
  }, [fetchCapabilities]);

  const toggleCircuit = (name: string) => {
    setSelectedCircuits((prev) => {
      if (prev.includes(name)) return prev.filter((x) => x !== name);
      if (prev.length >= 5) return prev;
      return [...prev, name];
    });
  };

  const runQuery = async () => {
    setQuerying(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/zkdefi/zkgraph/agent/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          prompt,
          user_address: userAddress || null,
          pool_id: poolId || null,
          strategy_id: strategyId || null,
          run_live_circuits: runLiveCircuits,
          scan_mode: scanMode,
          scan_circuits: runLiveCircuits ? (selectedCircuits.length ? selectedCircuits : null) : null,
          llm_synthesis: llmSynthesis,
        }),
      });
      if (!res.ok) throw new Error(`Agent query failed (${res.status})`);
      const data = (await res.json()) as AgentReport & { receipt?: Record<string, unknown> | null };
      setReport(data);
      if (data.receipt && onReceiptCreated) onReceiptCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent query failed");
    } finally {
      setQuerying(false);
    }
  };

  const attestedHits = useMemo(
    () => (report?.zkrag_queries || []).filter((q) => q.fact_hash).length,
    [report],
  );

  return (
    <div className="glass rounded-xl border border-zinc-800 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">zkRAG Agent Console</h3>
        </div>
        <button
          type="button"
          onClick={fetchCapabilities}
          disabled={loadingCapabilities}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/70 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingCapabilities ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-xs text-zinc-400">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="h-24 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-500"
          />
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2">
            <label className="text-xs text-zinc-400">Pool ID</label>
            <input
              value={poolId}
              onChange={(e) => setPoolId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-500"
            />
            <label className="text-xs text-zinc-400">Strategy ID</label>
            <input
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={runLiveCircuits}
                onChange={(e) => setRunLiveCircuits(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-900"
              />
              Run live circuits
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={llmSynthesis}
                onChange={(e) => setLlmSynthesis(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-900"
              />
              LLM synthesis
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400">Scan mode</label>
            <select
              value={scanMode}
              onChange={(e) => setScanMode((e.target.value as ScanMode) || "signal")}
              className="rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500"
            >
              <option value="signal">signal</option>
              <option value="gate">gate</option>
            </select>
          </div>
        </div>
      </div>

      {runLiveCircuits && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-3">
          <div className="mb-2 text-xs text-zinc-400">Live circuit set (max 5)</div>
          <div className="flex flex-wrap gap-2">
            {readyCircuits.slice(0, 20).map((name) => {
              const selected = selectedCircuits.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleCircuit(name)}
                  className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                    selected
                      ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-200"
                      : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {capabilities && (
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-zinc-300">
            Circuits {capabilities.circuits_ready}/{capabilities.circuits_total}
          </div>
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-zinc-300">
            Skills {capabilities.skills_ready}/{capabilities.skills_total}
          </div>
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-zinc-300">
            LLM providers {availableProviders.length}
          </div>
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-zinc-300">
            Wallet {userAddress ? "linked" : "not linked"}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={runQuery}
          disabled={querying || !prompt.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {querying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run zkRAG report
        </button>
      </div>

      {report && (
        <div className="rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <Shield className="w-3.5 h-3.5" />
              Confidence {(report.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-zinc-400">Attested hits {attestedHits}</span>
            <span className="text-zinc-400">Latency {report.duration_ms}ms</span>
            {report.synthesis?.provider && <span className="text-zinc-400">LLM {report.synthesis.provider}</span>}
          </div>

          {report.synthesis?.summary && (
            <div className="rounded border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-200">
              {report.synthesis.summary}
            </div>
          )}

          <div className="space-y-1">
            {(report.zkrag_queries || []).slice(0, 6).map((q, idx) => (
              <div key={`${q.query}-${idx}`} className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
                {q.available ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span className="truncate max-w-[360px]">{q.query}</span>
                <span className="text-zinc-500">results {q.results}</span>
                {q.fact_hash && <span className="font-mono text-cyan-300">{q.fact_hash.slice(0, 12)}…</span>}
              </div>
            ))}
          </div>

          {runLiveCircuits && report.circuits?.live_scan?.summary && (
            <div className="text-[11px] text-zinc-400">
              Live scan: compliant {report.circuits.live_scan.summary.compliant ?? 0}, non-compliant {report.circuits.live_scan.summary.non_compliant ?? 0}, failed {report.circuits.live_scan.summary.failed ?? 0}, skipped {report.circuits.live_scan.summary.skipped ?? 0}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


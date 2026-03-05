"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Check, Cpu, Loader2, Play, RefreshCw, ShieldAlert, Signal, X } from "lucide-react";

import { API_BASE } from "@/lib/api/client";

type CircuitReadout = {
  name: string;
  category: string;
  description: string;
  ready: boolean;
  has_default_inputs: boolean;
  skills: string[];
};

type ReadoutResponse = {
  stack: {
    proof_systems: string[];
    llm_skill_orchestration: boolean;
    composition_mode: string;
  };
  circuits: CircuitReadout[];
  onnx: {
    runtime_available: boolean;
    runtime_version: string | null;
    onnx_files_found: number;
    creditworthiness_meta_exists: boolean;
  };
};

type RunResult = {
  circuit: string;
  success: boolean;
  skipped?: boolean;
  is_compliant?: boolean | null;
  proof_hash?: string;
  duration_ms?: number;
  error?: string;
};

type RunResponse = {
  mode: string;
  all_pass: boolean;
  circuits_run: number;
  total_duration_ms: number;
  summary?: {
    compliant: number;
    non_compliant: number;
    failed: number;
    skipped: number;
  };
  results: RunResult[];
  human_summary?: string | null;
};

const DEFAULT_STACK = {
  proof_systems: ["cairo", "circom", "groth16"],
  llm_skill_orchestration: true,
  composition_mode: "composable_signals",
};

function normalizeReadoutResponse(payload: unknown): ReadoutResponse {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const stack = row.stack && typeof row.stack === "object" ? (row.stack as Record<string, unknown>) : {};
  const onnx = row.onnx && typeof row.onnx === "object" ? (row.onnx as Record<string, unknown>) : {};
  const circuitsRaw = Array.isArray(row.circuits) ? row.circuits : [];

  return {
    stack: {
      proof_systems: Array.isArray(stack.proof_systems)
        ? stack.proof_systems.map((x) => String(x))
        : DEFAULT_STACK.proof_systems,
      llm_skill_orchestration:
        typeof stack.llm_skill_orchestration === "boolean"
          ? stack.llm_skill_orchestration
          : DEFAULT_STACK.llm_skill_orchestration,
      composition_mode:
        typeof stack.composition_mode === "string"
          ? stack.composition_mode
          : DEFAULT_STACK.composition_mode,
    },
    circuits: circuitsRaw.map((entry) => {
      const c = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return {
        name: String(c.name ?? "unknown"),
        category: String(c.category ?? "uncategorized"),
        description: String(c.description ?? ""),
        ready: Boolean(c.ready),
        has_default_inputs: Boolean(c.has_default_inputs),
        skills: Array.isArray(c.skills) ? c.skills.map((x) => String(x)) : [],
      };
    }),
    onnx: {
      runtime_available: Boolean(onnx.runtime_available),
      runtime_version: onnx.runtime_version == null ? null : String(onnx.runtime_version),
      onnx_files_found: Number.isFinite(Number(onnx.onnx_files_found)) ? Number(onnx.onnx_files_found) : 0,
      creditworthiness_meta_exists: Boolean(onnx.creditworthiness_meta_exists),
    },
  };
}

function normalizeRunResponse(payload: unknown): RunResponse {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const summary = row.summary && typeof row.summary === "object" ? (row.summary as Record<string, unknown>) : {};
  const resultsRaw = Array.isArray(row.results) ? row.results : [];

  return {
    mode: String(row.mode ?? "signal"),
    all_pass: Boolean(row.all_pass),
    circuits_run: Number.isFinite(Number(row.circuits_run)) ? Number(row.circuits_run) : resultsRaw.length,
    total_duration_ms: Number.isFinite(Number(row.total_duration_ms)) ? Number(row.total_duration_ms) : 0,
    summary: {
      compliant: Number.isFinite(Number(summary.compliant)) ? Number(summary.compliant) : 0,
      non_compliant: Number.isFinite(Number(summary.non_compliant)) ? Number(summary.non_compliant) : 0,
      failed: Number.isFinite(Number(summary.failed)) ? Number(summary.failed) : 0,
      skipped: Number.isFinite(Number(summary.skipped)) ? Number(summary.skipped) : 0,
    },
    results: resultsRaw.map((entry) => {
      const r = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return {
        circuit: String(r.circuit ?? "unknown"),
        success: Boolean(r.success),
        skipped: typeof r.skipped === "boolean" ? r.skipped : undefined,
        is_compliant: typeof r.is_compliant === "boolean" ? r.is_compliant : null,
        proof_hash: r.proof_hash == null ? undefined : String(r.proof_hash),
        duration_ms: Number.isFinite(Number(r.duration_ms)) ? Number(r.duration_ms) : 0,
        error: r.error == null ? undefined : String(r.error),
      };
    }),
    human_summary: row.human_summary == null ? null : String(row.human_summary),
  };
}

export function CircuitReadoutPanel({ userAddress }: { userAddress: string }) {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [readout, setReadout] = useState<ReadoutResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [runOut, setRunOut] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const circuits = useMemo(() => readout?.circuits ?? [], [readout]);
  const runnable = useMemo(
    () => circuits.filter((c) => c.ready && c.has_default_inputs).map((c) => c.name),
    [circuits],
  );

  useEffect(() => {
    let dead = false;
    const fetchReadout = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/zkml/readout`, {
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) throw new Error(`Readout request failed (${res.status})`);
        const data = normalizeReadoutResponse(await res.json());
        if (dead) return;
        setReadout(data);
        setSelected(data.circuits.filter((c) => c.ready && c.has_default_inputs).map((c) => c.name));
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "Failed to load readout");
      } finally {
        if (!dead) setLoading(false);
      }
    };
    fetchReadout();
    return () => {
      dead = true;
    };
  }, []);

  const toggleCircuit = (name: string) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const runSignals = async () => {
    if (!selected.length) {
      setError("Select at least one circuit");
      return;
    }
    setRunning(true);
    setError(null);
    setRunOut(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/zkml/readout/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: userAddress,
          circuits: selected,
          mode: "signal",
          include_human_summary: true,
          context_label: "market_depth",
        }),
      });
      if (!res.ok) throw new Error(`Run failed (${res.status})`);
      const data = normalizeRunResponse(await res.json());
      setRunOut(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run circuits");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="glass rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Signal className="w-5 h-5 text-cyan-400" />
          Unified Circuit Readout
        </h3>
        <button
          onClick={() => setSelected(runnable)}
          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Select Runnable
        </button>
      </div>

      {loading && (
        <div className="py-8 text-zinc-400 text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading stack readout...
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded border border-red-700/40 bg-red-950/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {readout && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded border border-zinc-700 bg-zinc-900/40">
              <p className="text-[11px] text-zinc-500">Proof Stack</p>
              <p className="text-sm text-zinc-200">{readout.stack.proof_systems.join(" + ")}</p>
            </div>
            <div className="p-3 rounded border border-zinc-700 bg-zinc-900/40">
              <p className="text-[11px] text-zinc-500">Composition</p>
              <p className="text-sm text-zinc-200">{readout.stack.composition_mode}</p>
            </div>
            <div className="p-3 rounded border border-zinc-700 bg-zinc-900/40">
              <p className="text-[11px] text-zinc-500">ONNX Runtime</p>
              <p className="text-sm text-zinc-200">
                {readout.onnx.runtime_available ? `Ready (${readout.onnx.runtime_version ?? "?"})` : "Unavailable"}
              </p>
            </div>
            <div className="p-3 rounded border border-zinc-700 bg-zinc-900/40">
              <p className="text-[11px] text-zinc-500">ONNX Files</p>
              <p className="text-sm text-zinc-200">{readout.onnx.onnx_files_found}</p>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto border border-zinc-800 rounded-lg divide-y divide-zinc-800 mb-4">
            {circuits.map((c) => {
              const checked = selected.includes(c.name);
              const disabled = !(c.ready && c.has_default_inputs);
              return (
                <label
                  key={c.name}
                  className={`flex items-start gap-3 p-3 ${disabled ? "opacity-60" : "hover:bg-zinc-900/40"} cursor-pointer`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCircuit(c.name)}
                    disabled={disabled}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-100 font-medium">{c.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{c.category}</span>
                      {c.ready ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">ready</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">missing artifacts</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">{c.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(c.skills || []).map((s) => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300">
                          {s}
                        </span>
                      ))}
                      {!c.has_default_inputs && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300">
                          custom inputs required
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={runSignals}
              disabled={running || selected.length === 0}
              className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run Selected Signals
            </button>
            <button
              onClick={() => setSelected(runnable)}
              className="px-3 py-2 rounded border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset
            </button>
            <span className="text-xs text-zinc-500">{selected.length} selected</span>
          </div>

          {runOut && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg border border-zinc-700 bg-zinc-900/40">
                <div className="flex items-center gap-2 text-sm text-zinc-200 mb-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  Mode: <span className="font-mono">{runOut.mode}</span>
                  <span className="text-zinc-500">|</span>
                  <span>{runOut.circuits_run} circuits</span>
                  <span className="text-zinc-500">|</span>
                  <span>{runOut.total_duration_ms}ms</span>
                </div>
                {runOut.human_summary && (
                  <pre className="whitespace-pre-wrap text-xs text-zinc-300 bg-zinc-950/60 border border-zinc-800 rounded p-3">
                    {runOut.human_summary}
                  </pre>
                )}
              </div>

              <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 max-h-80 overflow-y-auto">
                {(runOut.results || []).map((r) => (
                  <div key={r.circuit} className="p-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-zinc-100 font-medium">{r.circuit}</p>
                      <p className="text-xs text-zinc-500">
                        {r.success ? `duration ${r.duration_ms ?? 0}ms` : r.error ?? "failed"}
                      </p>
                      {r.proof_hash && (
                        <p className="text-[11px] text-cyan-400 font-mono mt-1">
                          {r.proof_hash.slice(0, 20)}...
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      {!r.success && <X className="w-4 h-4 text-red-400 ml-auto" />}
                      {r.success && r.is_compliant === false && <ShieldAlert className="w-4 h-4 text-amber-400 ml-auto" />}
                      {r.success && r.is_compliant !== false && <Check className="w-4 h-4 text-emerald-400 ml-auto" />}
                      <p className="text-xs mt-1 text-zinc-400">
                        {!r.success ? "error" : r.is_compliant === false ? "signal: below bound" : "signal: within bound"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !readout && !error && (
        <div className="text-sm text-zinc-500">No circuit readout available.</div>
      )}

      <p className="mt-4 text-[11px] text-zinc-500 flex items-center gap-1.5">
        <Cpu className="w-3.5 h-3.5" />
        Cairo + Circom/Groth16 + ONNX/EZKL are exposed as composable signals for LLM-ready context.
      </p>
    </div>
  );
}

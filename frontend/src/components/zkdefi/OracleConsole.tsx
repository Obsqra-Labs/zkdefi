"use client";

/**
 * OracleConsole — Core oracle policy management UI.
 * Extracted from /oracle page for center-stage embedding.
 */

import { useCallback, useEffect, useState } from "react";
import { Shield, Activity, Settings, Zap, Eye } from "lucide-react";
import { apiFetch, apiFetchAuth } from "@/lib/api/client";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface GateRules {
  minReputationScore: number;
  maxRiskScore: number;
  requireCircuitVerified: boolean;
  preferPrivacyMode: string | null;
}

interface ExecutionRules {
  maxAllocationPct: number;
  dailyLimitUSD: number;
  autoExecute: boolean;
}

interface Policy {
  address: string;
  gateRules: GateRules;
  executionRules: ExecutionRules;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GatedSignal {
  id: string;
  type: string;
  score: number;
  allowed: boolean;
  reason: string;
}

interface OracleStatus {
  status: string;
  phase: string;
  components: Record<string, string>;
  readiness: Record<string, boolean>;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const POLICY_TEMPLATES: Record<string, Partial<GateRules & ExecutionRules>> = {
  conservative: {
    minReputationScore: 70, maxRiskScore: 30, requireCircuitVerified: true,
    preferPrivacyMode: "shielded", maxAllocationPct: 10, dailyLimitUSD: 5000, autoExecute: false,
  },
  balanced: {
    minReputationScore: 50, maxRiskScore: 50, requireCircuitVerified: false,
    preferPrivacyMode: null, maxAllocationPct: 20, dailyLimitUSD: 10000, autoExecute: false,
  },
  aggressive: {
    minReputationScore: 30, maxRiskScore: 80, requireCircuitVerified: false,
    preferPrivacyMode: null, maxAllocationPct: 40, dailyLimitUSD: 50000, autoExecute: true,
  },
  "privacy-first": {
    minReputationScore: 60, maxRiskScore: 40, requireCircuitVerified: true,
    preferPrivacyMode: "hashed_proof", maxAllocationPct: 15, dailyLimitUSD: 8000, autoExecute: false,
  },
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface OracleConsoleProps {
  address: string | undefined;
}

export function OracleConsole({ address }: OracleConsoleProps) {
  const [tab, setTab] = useState<"policy" | "signals" | "status">("policy");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [oracleStatus, setOracleStatus] = useState<OracleStatus | null>(null);
  const [signals, setSignals] = useState<GatedSignal[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [minRep, setMinRep] = useState(50);
  const [maxRisk, setMaxRisk] = useState(50);
  const [requireCircuit, setRequireCircuit] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<string | null>(null);
  const [maxAlloc, setMaxAlloc] = useState(20);
  const [dailyLimit, setDailyLimit] = useState(10000);
  const [autoExec, setAutoExec] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const loadPolicy = useCallback(async () => {
    if (!address) return;
    try {
      const p = await apiFetch<Policy>(`/api/v1/zkdefi/policies/${address}`);
      setPolicy(p);
      setMinRep(p.gateRules.minReputationScore);
      setMaxRisk(p.gateRules.maxRiskScore);
      setRequireCircuit(p.gateRules.requireCircuitVerified);
      setPrivacyMode(p.gateRules.preferPrivacyMode);
      setMaxAlloc(p.executionRules.maxAllocationPct);
      setDailyLimit(p.executionRules.dailyLimitUSD);
      setAutoExec(p.executionRules.autoExecute);
      setIsActive(p.isActive);
    } catch { /* defaults */ }
  }, [address]);

  const loadStatus = useCallback(async () => {
    try {
      const s = await apiFetch<OracleStatus>("/api/v1/zkdefi/oracle/status");
      setOracleStatus(s);
    } catch { /* skip */ }
  }, []);

  const loadSignals = useCallback(async () => {
    if (!address) return;
    try {
      const res = await apiFetch<{ signals: GatedSignal[] }>(
        `/api/v1/zkdefi/oracle/gated-signals?address=${address}&limit=10`,
      );
      setSignals(res.signals ?? []);
    } catch { /* skip */ }
  }, [address]);

  useEffect(() => {
    loadPolicy();
    loadStatus();
    loadSignals();
  }, [loadPolicy, loadStatus, loadSignals]);

  const savePolicy = async () => {
    if (!address) return;
    setSaving(true); setMsg("");
    try {
      await apiFetchAuth(`/api/v1/zkdefi/policies?address=${address}`, address, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          gateRules: { minReputationScore: minRep, maxRiskScore: maxRisk, requireCircuitVerified: requireCircuit, preferPrivacyMode: privacyMode },
          executionRules: { maxAllocationPct: maxAlloc, dailyLimitUSD: dailyLimit, autoExecute: autoExec },
          isActive,
        }),
      });
      setMsg("Policy saved ✓");
      loadPolicy();
    } catch (e: any) { setMsg(`Error: ${e.message ?? e}`); }
    finally { setSaving(false); }
  };

  const applyTemplate = (name: string) => {
    const t = POLICY_TEMPLATES[name]; if (!t) return;
    setMinRep(t.minReputationScore ?? 50); setMaxRisk(t.maxRiskScore ?? 50);
    setRequireCircuit(t.requireCircuitVerified ?? false); setPrivacyMode(t.preferPrivacyMode ?? null);
    setMaxAlloc(t.maxAllocationPct ?? 20); setDailyLimit(t.dailyLimitUSD ?? 10000);
    setAutoExec(t.autoExecute ?? false);
    setMsg(`Template "${name}" applied — save to persist.`);
  };

  if (!address) {
    return <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Connect wallet to manage oracle policies.</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Eye className="w-4.5 h-4.5 text-orange-400" />
          Oracle Command Center
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Configure execution policies, view gated signals, and monitor oracle health.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          ["policy", <Settings key="i" className="h-3.5 w-3.5" />, "Policy Editor"],
          ["signals", <Zap key="i" className="h-3.5 w-3.5" />, "Gated Signals"],
          ["status", <Activity key="i" className="h-3.5 w-3.5" />, "System Status"],
        ] as const).map(([key, icon, label]) => (
          <button key={key} onClick={() => setTab(key as any)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === key ? "bg-orange-600/20 text-orange-400 border border-orange-500/30" : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >{icon} {label}</button>
        ))}
      </div>

      {/* Policy Editor */}
      {tab === "policy" && (
        <div className="space-y-4">
          {/* Templates */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Quick Templates</h3>
            <div className="flex flex-wrap gap-2">
              {Object.keys(POLICY_TEMPLATES).map((name) => (
                <button key={name} onClick={() => applyTemplate(name)}
                  className="rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition capitalize"
                >{name.replace("-", " ")}</button>
              ))}
            </div>
          </div>

          {/* Gate Rules */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <Shield className="h-3.5 w-3.5 text-orange-400" /> Gate Rules
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] text-zinc-500">Min Reputation Score (0–100)</span>
                <input type="range" min={0} max={100} value={minRep} onChange={(e) => setMinRep(Number(e.target.value))} className="mt-1 w-full accent-orange-500" />
                <span className="text-xs font-mono text-orange-300">{minRep}</span>
              </label>
              <label className="block">
                <span className="text-[11px] text-zinc-500">Max Risk Score (0–100)</span>
                <input type="range" min={0} max={100} value={maxRisk} onChange={(e) => setMaxRisk(Number(e.target.value))} className="mt-1 w-full accent-orange-500" />
                <span className="text-xs font-mono text-orange-300">{maxRisk}</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={requireCircuit} onChange={(e) => setRequireCircuit(e.target.checked)} className="accent-orange-500 h-3.5 w-3.5" />
                Require Circuit Verification
              </label>
              <label className="block">
                <span className="text-[11px] text-zinc-500">Preferred Privacy Mode</span>
                <select value={privacyMode ?? "none"} onChange={(e) => setPrivacyMode(e.target.value === "none" ? null : e.target.value)}
                  className="mt-1 block w-full rounded bg-zinc-800 px-2.5 py-1.5 text-xs text-white border border-zinc-700"
                >
                  <option value="none">No preference</option>
                  <option value="public">Public</option>
                  <option value="shielded">Private</option>
                  <option value="hashed_proof">Private+</option>
                </select>
              </label>
            </div>
          </div>

          {/* Execution Rules */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <Zap className="h-3.5 w-3.5 text-orange-400" /> Execution Rules
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] text-zinc-500">Max Allocation %</span>
                <input type="number" min={0} max={100} value={maxAlloc} onChange={(e) => setMaxAlloc(Number(e.target.value))}
                  className="mt-1 block w-full rounded bg-zinc-800 px-2.5 py-1.5 text-xs text-white border border-zinc-700" />
              </label>
              <label className="block">
                <span className="text-[11px] text-zinc-500">Daily Limit (USD)</span>
                <input type="number" min={0} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))}
                  className="mt-1 block w-full rounded bg-zinc-800 px-2.5 py-1.5 text-xs text-white border border-zinc-700" />
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={autoExec} onChange={(e) => setAutoExec(e.target.checked)} className="accent-orange-500 h-3.5 w-3.5" />
                Auto-execute qualifying signals
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-orange-500 h-3.5 w-3.5" />
                Policy Active
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={savePolicy} disabled={saving}
              className="rounded-lg bg-orange-600 px-5 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50 transition"
            >{saving ? "Saving…" : "Save Policy"}</button>
            {msg && <span className={`text-xs ${msg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{msg}</span>}
          </div>

          {policy && (
            <div className="text-[10px] text-zinc-600 space-x-4">
              <span>Created: {new Date(policy.createdAt).toLocaleString()}</span>
              <span>Updated: {new Date(policy.updatedAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {/* Gated Signals */}
      {tab === "signals" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-3 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Recent Gated Signals</h3>
          {signals.length === 0 ? (
            <p className="text-zinc-500 text-xs py-6 text-center">No gated signals yet. Signals appear when the oracle circuit verification pipeline is active.</p>
          ) : (
            <div className="space-y-2">
              {signals.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-zinc-800/60 px-3 py-2.5">
                  <div>
                    <span className="text-xs font-medium text-zinc-200">{s.type}</span>
                    <span className="ml-2 text-[11px] text-zinc-500">score: {s.score}</span>
                  </div>
                  <span className={`text-[11px] font-semibold ${s.allowed ? "text-emerald-400" : "text-red-400"}`}>
                    {s.allowed ? "ALLOWED" : "BLOCKED"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* System Status */}
      {tab === "status" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-3 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Oracle System Status</h3>
          {oracleStatus ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${oracleStatus.status === "operational" ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className="text-sm font-medium text-zinc-200 capitalize">{oracleStatus.status}</span>
                <span className="text-[11px] text-zinc-500">({oracleStatus.phase})</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(oracleStatus.components).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-lg bg-zinc-800/60 px-3 py-2.5">
                    <span className="text-xs text-zinc-300 capitalize">{k.replace(/_/g, " ")}</span>
                    <span className={`text-[11px] font-semibold ${v === "active" ? "text-emerald-400" : "text-amber-400"}`}>{v}</span>
                  </div>
                ))}
              </div>
              <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mt-2">Readiness</h4>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(oracleStatus.readiness).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 rounded-lg bg-zinc-800/60 px-3 py-2.5">
                    <span className={`h-2 w-2 rounded-full ${v ? "bg-emerald-500" : "bg-zinc-600"}`} />
                    <span className="text-[11px] text-zinc-300 capitalize">{k.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-zinc-500 text-xs">Loading status…</p>
          )}
        </div>
      )}
    </div>
  );
}

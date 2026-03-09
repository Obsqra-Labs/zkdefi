"use client";

import { useAccount } from "@starknet-react/core";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { Shield, Activity, Settings, Zap, Eye } from "lucide-react";
import { apiFetch, apiFetchAuth } from "@/lib/api/client";
import { useCallback, useEffect, useState } from "react";

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
    minReputationScore: 70,
    maxRiskScore: 30,
    requireCircuitVerified: true,
    preferPrivacyMode: "shielded",
    maxAllocationPct: 10,
    dailyLimitUSD: 5000,
    autoExecute: false,
  },
  balanced: {
    minReputationScore: 50,
    maxRiskScore: 50,
    requireCircuitVerified: false,
    preferPrivacyMode: null,
    maxAllocationPct: 20,
    dailyLimitUSD: 10000,
    autoExecute: false,
  },
  aggressive: {
    minReputationScore: 30,
    maxRiskScore: 80,
    requireCircuitVerified: false,
    preferPrivacyMode: null,
    maxAllocationPct: 40,
    dailyLimitUSD: 50000,
    autoExecute: true,
  },
  "privacy-first": {
    minReputationScore: 60,
    maxRiskScore: 40,
    requireCircuitVerified: true,
    preferPrivacyMode: "hashed_proof",
    maxAllocationPct: 15,
    dailyLimitUSD: 8000,
    autoExecute: false,
  },
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function OraclePage() {
  const { address, isConnected } = useAccount();

  const [tab, setTab] = useState<"policy" | "signals" | "status">("policy");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [oracleStatus, setOracleStatus] = useState<OracleStatus | null>(null);
  const [signals, setSignals] = useState<GatedSignal[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Editable form state
  const [minRep, setMinRep] = useState(50);
  const [maxRisk, setMaxRisk] = useState(50);
  const [requireCircuit, setRequireCircuit] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<string | null>(null);
  const [maxAlloc, setMaxAlloc] = useState(20);
  const [dailyLimit, setDailyLimit] = useState(10000);
  const [autoExec, setAutoExec] = useState(false);
  const [isActive, setIsActive] = useState(true);

  /* ---------------------------------------------------------------- */
  /* Fetch                                                             */
  /* ---------------------------------------------------------------- */

  const loadPolicy = useCallback(async () => {
    if (!address) return;
    try {
      const p = await apiFetch<Policy>(
        `/api/v1/zkdefi/policies/${address}`,
      );
      setPolicy(p);
      setMinRep(p.gateRules.minReputationScore);
      setMaxRisk(p.gateRules.maxRiskScore);
      setRequireCircuit(p.gateRules.requireCircuitVerified);
      setPrivacyMode(p.gateRules.preferPrivacyMode);
      setMaxAlloc(p.executionRules.maxAllocationPct);
      setDailyLimit(p.executionRules.dailyLimitUSD);
      setAutoExec(p.executionRules.autoExecute);
      setIsActive(p.isActive);
    } catch {
      // Use defaults on first load
    }
  }, [address]);

  const loadStatus = useCallback(async () => {
    try {
      const s = await apiFetch<OracleStatus>(
        "/api/v1/zkdefi/oracle/status",
      );
      setOracleStatus(s);
    } catch {
      /* skip */
    }
  }, []);

  const loadSignals = useCallback(async () => {
    if (!address) return;
    try {
      const res = await apiFetch<{ signals: GatedSignal[] }>(
        `/api/v1/zkdefi/oracle/gated-signals?address=${address}&limit=10`,
      );
      setSignals(res.signals ?? []);
    } catch {
      /* skip */
    }
  }, [address]);

  useEffect(() => {
    loadPolicy();
    loadStatus();
    loadSignals();
  }, [loadPolicy, loadStatus, loadSignals]);

  /* ---------------------------------------------------------------- */
  /* Save                                                              */
  /* ---------------------------------------------------------------- */

  const savePolicy = async () => {
    if (!address) return;
    setSaving(true);
    setMsg("");
    try {
      await apiFetchAuth(
        `/api/v1/zkdefi/policies?address=${address}`,
        address,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            gateRules: {
              minReputationScore: minRep,
              maxRiskScore: maxRisk,
              requireCircuitVerified: requireCircuit,
              preferPrivacyMode: privacyMode,
            },
            executionRules: {
              maxAllocationPct: maxAlloc,
              dailyLimitUSD: dailyLimit,
              autoExecute: autoExec,
            },
            isActive,
          }),
        },
      );
      setMsg("Policy saved ✓");
      loadPolicy();
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (name: string) => {
    const t = POLICY_TEMPLATES[name];
    if (!t) return;
    setMinRep(t.minReputationScore ?? 50);
    setMaxRisk(t.maxRiskScore ?? 50);
    setRequireCircuit(t.requireCircuitVerified ?? false);
    setPrivacyMode(t.preferPrivacyMode ?? null);
    setMaxAlloc(t.maxAllocationPct ?? 20);
    setDailyLimit(t.dailyLimitUSD ?? 10000);
    setAutoExec(t.autoExecute ?? false);
    setMsg(`Template "${name}" applied — save to persist.`);
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
      <AppNavbar />

      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-bold tracking-tight flex items-center gap-2">
          <Eye className="h-7 w-7 text-orange-400" /> Oracle Command Center
        </h1>
        <p className="mb-8 text-gray-400">
          Configure execution policies, view gated signals, and monitor oracle health.
        </p>

        {!isConnected ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-800 bg-gray-900/60 p-12">
            <p className="text-gray-400">Connect your wallet to manage policies.</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="mb-6 flex gap-2">
              {(
                [
                  ["policy", <Settings key="i" className="h-4 w-4" />, "Policy Editor"],
                  ["signals", <Zap key="i" className="h-4 w-4" />, "Gated Signals"],
                  ["status", <Activity key="i" className="h-4 w-4" />, "System Status"],
                ] as const
              ).map(([key, icon, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key as any)}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    tab === key
                      ? "bg-orange-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {/* ---- Policy Editor ---- */}
            {tab === "policy" && (
              <div className="space-y-6">
                {/* Template selector */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
                  <h3 className="mb-3 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                    Quick Templates
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(POLICY_TEMPLATES).map((name) => (
                      <button
                        key={name}
                        onClick={() => applyTemplate(name)}
                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition capitalize"
                      >
                        {name.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Gate Rules */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                    <Shield className="h-4 w-4 text-orange-400" /> Gate Rules
                  </h3>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Min Reputation */}
                    <label className="block">
                      <span className="text-xs text-gray-400">Min Reputation Score (0–100)</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={minRep}
                        onChange={(e) => setMinRep(Number(e.target.value))}
                        className="mt-1 w-full accent-orange-500"
                      />
                      <span className="text-sm font-mono text-orange-300">{minRep}</span>
                    </label>

                    {/* Max Risk */}
                    <label className="block">
                      <span className="text-xs text-gray-400">Max Risk Score (0–100)</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={maxRisk}
                        onChange={(e) => setMaxRisk(Number(e.target.value))}
                        className="mt-1 w-full accent-orange-500"
                      />
                      <span className="text-sm font-mono text-orange-300">{maxRisk}</span>
                    </label>

                    {/* Require Circuit */}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={requireCircuit}
                        onChange={(e) => setRequireCircuit(e.target.checked)}
                        className="accent-orange-500 h-4 w-4"
                      />
                      Require Circuit Verification
                    </label>

                    {/* Privacy Mode */}
                    <label className="block">
                      <span className="text-xs text-gray-400">Preferred Privacy Mode</span>
                      <select
                        value={privacyMode ?? "none"}
                        onChange={(e) =>
                          setPrivacyMode(e.target.value === "none" ? null : e.target.value)
                        }
                        className="mt-1 block w-full rounded bg-gray-800 px-3 py-2 text-sm text-white"
                      >
                        <option value="none">No preference</option>
                        <option value="public">Public</option>
                        <option value="shielded">Shielded</option>
                        <option value="hashed_proof">Max Privacy</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Execution Rules */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                    <Zap className="h-4 w-4 text-orange-400" /> Execution Rules
                  </h3>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Max Allocation */}
                    <label className="block">
                      <span className="text-xs text-gray-400">Max Allocation %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={maxAlloc}
                        onChange={(e) => setMaxAlloc(Number(e.target.value))}
                        className="mt-1 block w-full rounded bg-gray-800 px-3 py-2 text-sm text-white"
                      />
                    </label>

                    {/* Daily Limit */}
                    <label className="block">
                      <span className="text-xs text-gray-400">Daily Limit (USD)</span>
                      <input
                        type="number"
                        min={0}
                        value={dailyLimit}
                        onChange={(e) => setDailyLimit(Number(e.target.value))}
                        className="mt-1 block w-full rounded bg-gray-800 px-3 py-2 text-sm text-white"
                      />
                    </label>

                    {/* Auto Execute */}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={autoExec}
                        onChange={(e) => setAutoExec(e.target.checked)}
                        className="accent-orange-500 h-4 w-4"
                      />
                      Auto-execute qualifying signals
                    </label>

                    {/* Active toggle */}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="accent-orange-500 h-4 w-4"
                      />
                      Policy Active
                    </label>
                  </div>
                </div>

                {/* Save */}
                <div className="flex items-center gap-4">
                  <button
                    onClick={savePolicy}
                    disabled={saving}
                    className="rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-semibold hover:bg-orange-500 disabled:opacity-50 transition"
                  >
                    {saving ? "Saving…" : "Save Policy"}
                  </button>
                  {msg && (
                    <span
                      className={`text-sm ${msg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
                    >
                      {msg}
                    </span>
                  )}
                </div>

                {/* Metadata */}
                {policy && (
                  <div className="text-xs text-gray-500 space-x-4">
                    <span>Created: {new Date(policy.createdAt).toLocaleString()}</span>
                    <span>Updated: {new Date(policy.updatedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {/* ---- Gated Signals ---- */}
            {tab === "signals" && (
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                  Recent Gated Signals
                </h3>
                {signals.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    No gated signals yet. Signals will appear here when the oracle circuit
                    verification pipeline is active.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {signals.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg bg-gray-800/60 px-4 py-3"
                      >
                        <div>
                          <span className="text-sm font-medium">{s.type}</span>
                          <span className="ml-2 text-xs text-gray-500">score: {s.score}</span>
                        </div>
                        <span
                          className={`text-xs font-semibold ${
                            s.allowed ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {s.allowed ? "ALLOWED" : "BLOCKED"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- Status ---- */}
            {tab === "status" && (
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                  Oracle System Status
                </h3>
                {oracleStatus ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-3 w-3 rounded-full ${
                          oracleStatus.status === "operational"
                            ? "bg-green-500"
                            : "bg-yellow-500"
                        }`}
                      />
                      <span className="font-medium capitalize">{oracleStatus.status}</span>
                      <span className="text-xs text-gray-500">({oracleStatus.phase})</span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {Object.entries(oracleStatus.components).map(([k, v]) => (
                        <div
                          key={k}
                          className="flex items-center justify-between rounded-lg bg-gray-800/60 px-4 py-3"
                        >
                          <span className="text-sm text-gray-300 capitalize">
                            {k.replace(/_/g, " ")}
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              v === "active" ? "text-green-400" : "text-yellow-400"
                            }`}
                          >
                            {v}
                          </span>
                        </div>
                      ))}
                    </div>

                    <h4 className="text-xs font-semibold text-gray-400 uppercase mt-4">
                      Readiness
                    </h4>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {Object.entries(oracleStatus.readiness).map(([k, v]) => (
                        <div
                          key={k}
                          className="flex items-center gap-2 rounded-lg bg-gray-800/60 px-4 py-3"
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              v ? "bg-green-500" : "bg-gray-600"
                            }`}
                          />
                          <span className="text-xs text-gray-300 capitalize">
                            {k.replace(/_/g, " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">Loading status…</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Activity,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Zap,
  TrendingUp,
  ArrowDownUp,
  Brain,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Tooltip } from "@/components/zkdefi/Tooltip";
import {
  getAutoAgentStatus,
  startAutoAgent,
  stopAutoAgent,
  pauseAutoAgent,
  resumeAutoAgent,
  getVaultPolicy,
  updateVaultPolicy,
  fetchNarration,
  type AutoAgentStatus,
  type VaultPolicy,
} from "@/lib/api/strategies";
import { useApp } from "@/lib/AppContext";
import { toastSuccess } from "@/lib/toast";

interface AutomationControlPanelProps {
  userAddress: string;
  activeSessionId: string | null;
  constraints: {
    risk_profile: string | null;
    max_position_usd: number | null;
    session_duration_hours: number | null;
  } | null;
}

const STATE_COLORS: Record<string, string> = {
  running: "text-emerald-400",
  paused: "text-amber-400",
  stopped: "text-zinc-400",
  error: "text-red-400",
};

const STATE_LABELS: Record<string, string> = {
  running: "Running",
  paused: "Paused",
  stopped: "Stopped",
  error: "Error",
};

const STATE_DOT: Record<string, string> = {
  running: "bg-emerald-400 animate-pulse",
  paused: "bg-amber-400",
  stopped: "bg-zinc-500",
  error: "bg-red-400 animate-pulse",
};

export function AutomationControlPanel({
  userAddress,
  activeSessionId,
  constraints,
}: AutomationControlPanelProps) {
  const { invalidateTabs } = useApp();
  const [agentStatus, setAgentStatus] = useState<AutoAgentStatus | null>(null);
  const [policy, setPolicy] = useState<VaultPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narration, setNarration] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const refresh = useCallback(async () => {
    if (!userAddress) return;
    try {
      const [status, pol] = await Promise.all([
        getAutoAgentStatus(userAddress),
        getVaultPolicy(userAddress),
      ]);
      setAgentStatus(status);
      setPolicy(pol);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityPolling(refresh, 30_000, [refresh]);

  // Fetch narration about what the AI will do
  useEffect(() => {
    if (!policy || !constraints?.risk_profile) return;
    const perms = policy.strategy_permissions;
    const actions = [
      perms.enable_lp && "provide liquidity on Ekubo",
      perms.enable_rebalance && "rebalance positions when drift exceeds threshold",
      perms.enable_rotation && "rotate between pools for better yield",
      perms.enable_dca && "dollar-cost average into positions",
    ].filter(Boolean);
    fetchNarration("strategy_recommendation", {
      risk_profile: constraints.risk_profile,
      tier: 1,
      passport_score: 50,
      balance: 0,
      allocated: 0,
      best_apy: 12,
    })
      .then((r) => setNarration(r.narration))
      .catch(() => setNarration(`AI will ${actions.join(", ")}.`));
  }, [policy, constraints]);

  const handleStart = async () => {
    if (!activeSessionId) {
      setError("Grant a session key first (see Session Key Manager above).");
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const normalizedRiskProfile = (constraints?.risk_profile ?? "").toLowerCase();
      const riskThreshold =
        normalizedRiskProfile === "conservative" || normalizedRiskProfile === "low"
          ? 35
          : normalizedRiskProfile === "aggressive" || normalizedRiskProfile === "high"
            ? 70
            : 50;
      const result = await startAutoAgent(
        userAddress,
        activeSessionId,
        intervalMinutes,
        riskThreshold,
      );
      setAgentStatus(result);
      toastSuccess("Autonomous agent started");
      invalidateTabs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const result = await stopAutoAgent(userAddress);
      setAgentStatus(result);
      toastSuccess("Autonomous agent stopped");
      invalidateTabs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    try {
      const result = await pauseAutoAgent(userAddress);
      setAgentStatus(result);
      toastSuccess("Agent paused");
      invalidateTabs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      const result = await resumeAutoAgent(userAddress);
      setAgentStatus(result);
      toastSuccess("Agent resumed");
      invalidateTabs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(false);
    }
  };

  const togglePermission = async (key: string, value: boolean) => {
    if (!policy) return;
    try {
      const updated = await updateVaultPolicy(userAddress, {
        strategy_permissions: { ...policy.strategy_permissions, [key]: value },
      });
      setPolicy(updated);
    } catch {
      // revert will happen on next refresh
    }
  };

  const updateExecutionMode = async (mode: string) => {
    try {
      const updated = await updateVaultPolicy(userAddress, {
        execution_policy: { mode },
      });
      setPolicy(updated);
    } catch {
      // will refresh
    }
  };

  const state = agentStatus?.state ?? "stopped";
  const isRunning = state === "running";
  const isPaused = state === "paused";

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-48 mb-4" />
        <div className="h-24 bg-zinc-800 rounded" />
      </div>
    );
  }

  const perms = policy?.strategy_permissions;
  const execPolicy = policy?.execution_policy;
  const riskBudget = policy?.risk_budget;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Header: Agent State */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${STATE_DOT[state]}`} />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              AI Automation
              <span className={`text-xs font-medium ${STATE_COLORS[state]}`}>
                {STATE_LABELS[state]}
              </span>
            </h3>
            <p className="text-xs text-zinc-500">
              {isRunning
                ? `Checking every ${agentStatus?.interval_seconds ? Math.round(agentStatus.interval_seconds / 60) : intervalMinutes}m · ${agentStatus?.actions_taken ?? 0} actions taken`
                : isPaused
                ? "Paused — positions monitored but no actions"
                : "Not running — start to enable autonomous management"}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
          title="Refresh status"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* What the AI does */}
      {narration && (
        <div className="px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/30">
          <div className="flex items-start gap-2">
            <Brain className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-400 leading-relaxed">{narration}</p>
          </div>
        </div>
      )}

      {/* Approved Actions */}
      <div className="p-4 border-b border-zinc-800/50">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Approved Actions
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: "enable_lp", label: "LP Provision", desc: "Ekubo concentrated LP", icon: TrendingUp },
            { key: "enable_rebalance", label: "Rebalance", desc: "Drift-based reallocation", icon: ArrowDownUp },
            { key: "enable_rotation", label: "Pool Rotation", desc: "Move to better-yielding pools", icon: RefreshCw },
            { key: "enable_dca", label: "DCA", desc: "Dollar-cost averaging", icon: Activity },
          ].map(({ key, label, desc, icon: Icon }) => {
            const enabled = perms?.[key as keyof typeof perms] ?? false;
            return (
              <button
                key={key}
                onClick={() => togglePermission(key, !enabled)}
                disabled={isRunning}
                className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                  enabled
                    ? "border-emerald-800/40 bg-emerald-950/20"
                    : "border-zinc-800 bg-zinc-900/40 opacity-60"
                } ${isRunning ? "cursor-not-allowed" : "hover:border-zinc-700"}`}
              >
                <div className={`mt-0.5 ${enabled ? "text-emerald-400" : "text-zinc-600"}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium ${enabled ? "text-zinc-200" : "text-zinc-500"}`}>
                      {label}
                    </span>
                    {enabled ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3 h-3 text-zinc-600" />
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-500 leading-tight">{desc}</span>
                </div>
              </button>
            );
          })}
        </div>
        {isRunning && (
          <p className="text-[10px] text-zinc-600 mt-2">
            Stop automation to change permissions
          </p>
        )}

        {/* Unavailable actions */}
        <div className="mt-3 space-y-1">
          {[
            { label: "Token Swaps", reason: "Calldata-only — requires wallet signing" },
            { label: "Staking", reason: "Not yet implemented" },
            { label: "JediSwap LP", reason: "Not yet implemented" },
          ].map(({ label, reason }) => (
            <div key={label} className="flex items-center gap-2 text-[10px] text-zinc-600">
              <XCircle className="w-3 h-3 shrink-0" />
              <span>{label}</span>
              <span className="text-zinc-700">— {reason}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Constraints summary */}
      <div className="p-4 border-b border-zinc-800/50">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Constraints & Limits
        </h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-zinc-200">
              {constraints?.risk_profile ?? "—"}
            </div>
            <div className="text-[10px] text-zinc-500">Risk Profile</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-zinc-200">
              ${execPolicy?.session_max_notional_usd?.toLocaleString() ?? "—"}
            </div>
            <div className="text-[10px] text-zinc-500">Session Max</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-zinc-200">
              {riskBudget?.max_position_pct ?? "—"}%
            </div>
            <div className="text-[10px] text-zinc-500">Max Single Pool</div>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {execPolicy?.cooldown_seconds ? `${execPolicy.cooldown_seconds}s cooldown` : "—"}
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Max drawdown {riskBudget?.max_drawdown_bps ? `${(riskBudget.max_drawdown_bps / 100).toFixed(0)}%` : "—"}
          </span>
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            Daily turnover {riskBudget?.max_daily_turnover_bps ? `${(riskBudget.max_daily_turnover_bps / 100).toFixed(0)}%` : "—"}
          </span>
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="mt-2 text-[10px] text-violet-400 hover:text-violet-300 transition"
        >
          {showAdvanced ? "Hide advanced settings" : "Edit constraints →"}
        </button>
      </div>

      {/* Advanced constraint editor (inline) */}
      {showAdvanced && (
        <ConstraintEditor
          policy={policy!}
          constraints={constraints}
          userAddress={userAddress}
          onUpdate={setPolicy}
          disabled={isRunning}
        />
      )}

      {/* Execution mode */}
      <div className="p-4 border-b border-zinc-800/50">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Execution Mode
        </h4>
        <div className="flex gap-2">
          {[
            { id: "manual_only", label: "Manual", desc: "You approve each action" },
            { id: "assist", label: "Assist", desc: "AI suggests, you confirm" },
            { id: "autonomous", label: "Autonomous", desc: "AI executes within constraints" },
          ].map(({ id, label, desc }) => (
            <button
              key={id}
              onClick={() => updateExecutionMode(id)}
              disabled={isRunning}
              className={`flex-1 rounded-lg border p-2 text-center transition ${
                execPolicy?.mode === id
                  ? "border-violet-700/50 bg-violet-950/30 text-violet-300"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700"
              } ${isRunning ? "cursor-not-allowed" : ""}`}
            >
              <div className="text-xs font-medium">{label}</div>
              <div className="text-[10px] opacity-70">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-3 mb-0 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="p-4 flex items-center gap-2">
        {!isRunning && !isPaused && (
          <Tooltip 
            content={!activeSessionId ? "Grant a session key first to enable autonomous mode" : "Start AI-powered autonomous capital management"}
            position="top"
          >
            <button
              onClick={handleStart}
              disabled={actionLoading || !activeSessionId}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-white px-4 py-2.5 text-sm font-medium transition"
            >
              {actionLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Start Automation
            </button>
          </Tooltip>
        )}
        {isRunning && (
          <>
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-white px-4 py-2.5 text-sm font-medium transition"
            >
              <Pause className="w-4 h-4" />
              Pause
            </button>
            <button
              onClick={handleStop}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-red-600/80 hover:bg-red-500 text-white px-4 py-2.5 text-sm font-medium transition"
            >
              <Square className="w-4 h-4" />
              Stop
            </button>
          </>
        )}
        {isPaused && (
          <>
            <button
              onClick={handleResume}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 text-sm font-medium transition"
            >
              <Play className="w-4 h-4" />
              Resume
            </button>
            <button
              onClick={handleStop}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-red-600/80 hover:bg-red-500 text-white px-4 py-2.5 text-sm font-medium transition"
            >
              <Square className="w-4 h-4" />
              Stop
            </button>
          </>
        )}
        {!activeSessionId && !isRunning && (
          <p className="text-[10px] text-amber-500">
            ↑ Grant a session key first
          </p>
        )}
      </div>

      {/* Interval selector (only when stopped) */}
      {!isRunning && !isPaused && (
        <div className="px-4 pb-4 flex items-center gap-3">
          <label className="text-[10px] text-zinc-500">Check interval</label>
          <select
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1"
          >
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
          </select>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Inline Constraint Editor
   ──────────────────────────────────────────────────────────────────────── */

function ConstraintEditor({
  policy,
  constraints,
  userAddress,
  onUpdate,
  disabled,
}: {
  policy: VaultPolicy;
  constraints: AutomationControlPanelProps["constraints"];
  userAddress: string;
  onUpdate: (p: VaultPolicy) => void;
  disabled: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    session_max_notional_usd: policy.execution_policy.session_max_notional_usd,
    max_position_pct: policy.risk_budget.max_position_pct,
    max_drawdown_bps: policy.risk_budget.max_drawdown_bps,
    max_daily_turnover_bps: policy.risk_budget.max_daily_turnover_bps,
    cooldown_seconds: policy.execution_policy.cooldown_seconds,
    session_duration_hours: policy.execution_policy.session_duration_hours,
  });

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateVaultPolicy(userAddress, {
        risk_budget: {
          max_position_pct: draft.max_position_pct,
          max_drawdown_bps: draft.max_drawdown_bps,
          max_daily_turnover_bps: draft.max_daily_turnover_bps,
        },
        execution_policy: {
          session_max_notional_usd: draft.session_max_notional_usd,
          cooldown_seconds: draft.cooldown_seconds,
          session_duration_hours: draft.session_duration_hours,
        },
      });
      onUpdate(updated);
    } catch {
      // refresh will correct
    } finally {
      setSaving(false);
    }
  };

  const fields: Array<{
    key: keyof typeof draft;
    label: string;
    unit: string;
    min: number;
    max: number;
    step: number;
  }> = [
    { key: "session_max_notional_usd", label: "Session Max $", unit: "USD", min: 10, max: 100000, step: 50 },
    { key: "max_position_pct", label: "Max Single Pool", unit: "%", min: 5, max: 100, step: 5 },
    { key: "max_drawdown_bps", label: "Max Drawdown", unit: "bps", min: 100, max: 5000, step: 100 },
    { key: "max_daily_turnover_bps", label: "Daily Turnover", unit: "bps", min: 100, max: 10000, step: 100 },
    { key: "cooldown_seconds", label: "Action Cooldown", unit: "sec", min: 30, max: 3600, step: 30 },
    { key: "session_duration_hours", label: "Session Duration", unit: "hrs", min: 1, max: 168, step: 1 },
  ];

  return (
    <div className="p-4 border-b border-zinc-800/50 bg-zinc-950/30">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(({ key, label, unit, min, max, step }) => (
          <div key={key}>
            <label className="text-[10px] text-zinc-500 block mb-1">
              {label} <span className="text-zinc-600">({unit})</span>
            </label>
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))}
              disabled={disabled}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 disabled:opacity-50"
            />
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={disabled || saving}
        className="mt-3 w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 text-white text-xs font-medium py-2 transition"
      >
        {saving ? "Saving..." : "Save Constraints"}
      </button>
    </div>
  );
}

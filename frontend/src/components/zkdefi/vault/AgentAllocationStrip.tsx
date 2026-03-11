"use client";

/**
 * AgentAllocationStrip — Phase D: agent integration display.
 *
 * Shows:
 * 1. Target vs actual allocation per pool (drift indicator)
 * 2. "Rebalance Now" button that triggers backend rebalance analysis
 * 3. Session key status (active / expired / none)
 * 4. Autonomous agent state (running / paused / off)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  KeyRound,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
import { API_BASE, apiFetch, apiFetchAuth } from "@/lib/api/client";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolAlloc {
  key: "conservative" | "moderate" | "aggressive";
  label: string;
  targetPct: number;
  actualPct: number;
  color: string;
}

interface SessionKey {
  session_id: string;
  status: string;
  expiry?: string;
  protocols_mask?: number;
}

interface AutonomousState {
  state: string;
  checks_count?: number;
  actions_count?: number;
  last_check?: string;
  paused?: boolean;
}

export interface AgentAllocationStripProps {
  address?: string;
  commitments: VaultCommitment[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POOL_ORDER = ["conservative", "moderate", "aggressive"] as const;

const POOL_META: Record<
  string,
  { label: string; barColor: string; textColor: string }
> = {
  conservative: { label: "Conservative", barColor: "bg-blue-400", textColor: "text-blue-400" },
  moderate:     { label: "Moderate",     barColor: "bg-emerald-400", textColor: "text-emerald-400" },
  aggressive:   { label: "Aggressive",   barColor: "bg-orange-400", textColor: "text-orange-400" },
};

function resolvePoolKey(c: VaultCommitment): "conservative" | "moderate" | "aggressive" {
  const v = c.pool_variant?.toLowerCase();
  if (v === "conservative" || v === "moderate" || v === "aggressive") return v;
  if (v === "balanced" || v === "neutral") return "moderate";
  if (c.pool_type === 0) return "conservative";
  if (c.pool_type === 2) return "aggressive";
  return "moderate";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentAllocationStrip({ address, commitments }: AgentAllocationStripProps) {
  const [targetWeights, setTargetWeights] = useState<Record<string, number> | null>(null);
  const [sessionKeys, setSessionKeys] = useState<SessionKey[]>([]);
  const [agentState, setAgentState] = useState<AutonomousState | null>(null);
  const [rebalancing, setRebalancing] = useState(false);
  const [rebalanceResult, setRebalanceResult] = useState<string | null>(null);

  // ---- Compute actual allocation from commitments ----
  const actualAlloc = useMemo(() => {
    const totals: Record<string, bigint> = { conservative: BigInt(0), moderate: BigInt(0), aggressive: BigInt(0) };
    let total = BigInt(0);
    for (const c of commitments) {
      const key = resolvePoolKey(c);
      const amt = BigInt(c.amount_wei || "0");
      totals[key] += amt;
      total += amt;
    }
    const pcts: Record<string, number> = {};
    for (const k of POOL_ORDER) {
      pcts[k] = total > BigInt(0) ? Number((totals[k] * BigInt(10000)) / total) / 100 : 0;
    }
    return pcts;
  }, [commitments]);

  // ---- Fetch target weights from oracle recommendation ----
  useEffect(() => {
    let dead = false;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/v1/strategies/recommend`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_address: address || "0x0",
              risk_profile: "balanced",
              amount: 1000,
            }),
            signal: controller.signal,
          },
        );
        if (!res.ok || dead) return;
        const d = await res.json();
        const pools = d.recommended_pools ?? [];
        const w: Record<string, number> = { conservative: 0, moderate: 0, aggressive: 0 };
        for (const p of pools) {
          const key = (p.pool_type ?? p.pool_id ?? "").toLowerCase();
          const pct = p.allocation_pct ?? 0;
          if (key.includes("conservative")) w.conservative += pct;
          else if (key.includes("aggressive")) w.aggressive += pct;
          else w.moderate += pct;
        }
        // Normalize to 100
        const sum = w.conservative + w.moderate + w.aggressive;
        if (sum > 0) {
          w.conservative = Math.round((w.conservative / sum) * 100);
          w.aggressive = Math.round((w.aggressive / sum) * 100);
          w.moderate = 100 - w.conservative - w.aggressive;
        } else {
          // Default balanced
          w.conservative = 30; w.moderate = 40; w.aggressive = 30;
        }
        if (!dead) setTargetWeights(w);
      } catch {
        // Fallback
        if (!dead) setTargetWeights({ conservative: 30, moderate: 40, aggressive: 30 });
      }
    })();

    return () => { dead = true; controller.abort(); };
  }, [address]);

  // ---- Fetch session keys ----
  useEffect(() => {
    if (!address) return;
    let dead = false;
    (async () => {
      try {
        const data = await apiFetch<{ keys?: SessionKey[]; sessions?: SessionKey[] }>(
          `/api/v1/zkdefi/session_keys/list/${address}`,
        );
        if (!dead) setSessionKeys(data.keys ?? data.sessions ?? []);
      } catch {
        /* no keys */
      }
    })();
    return () => { dead = true; };
  }, [address]);

  // ---- Fetch autonomous agent status ----
  useEffect(() => {
    if (!address) return;
    let dead = false;
    (async () => {
      try {
        const data = await apiFetch<AutonomousState>(
          `/api/v1/zkdefi/rebalancer/autonomous/status/${address}`,
        );
        if (!dead) setAgentState(data);
      } catch {
        /* agent may not be started */
      }
    })();
    return () => { dead = true; };
  }, [address]);

  // ---- Rebalance handler ----
  const handleRebalance = useCallback(async () => {
    if (!address || rebalancing) return;
    setRebalancing(true);
    setRebalanceResult(null);
    try {
      const result = await apiFetchAuth<{ needs_rebalance?: boolean; recommendation?: string; detail?: string }>(
        `/api/v1/zkdefi/rebalancer/analyze`,
        address,
        {
          method: "POST",
          body: JSON.stringify({
            user_address: address,
            positions: {},
          }),
        },
      );
      if (result.needs_rebalance) {
        setRebalanceResult("Drift detected — rebalance proposal created");
      } else {
        setRebalanceResult(result.recommendation ?? "Portfolio is balanced — no rebalance needed");
      }
    } catch (err: any) {
      setRebalanceResult(`Error: ${err.message ?? "Unknown"}`);
    } finally {
      setRebalancing(false);
    }
  }, [address, rebalancing]);

  // ---- Compute drift ----
  const driftData = useMemo<PoolAlloc[]>(() => {
    const tw = targetWeights ?? { conservative: 30, moderate: 40, aggressive: 30 };
    return POOL_ORDER.map((k) => ({
      key: k,
      label: POOL_META[k].label,
      targetPct: tw[k],
      actualPct: actualAlloc[k],
      color: POOL_META[k].barColor,
    }));
  }, [targetWeights, actualAlloc]);

  const maxDrift = useMemo(
    () => Math.max(...driftData.map((d) => Math.abs(d.targetPct - d.actualPct))),
    [driftData],
  );

  const hasCommitments = commitments.length > 0;

  // ---- Session key summary ----
  const activeKeys = sessionKeys.filter(
    (k) => k.status === "active" || k.status === "confirmed",
  );

  const agentRunning = agentState?.state === "running" && !agentState?.paused;

  // ---- Render ----
  return (
    <div className="rounded-xl border border-violet-800/30 bg-gradient-to-r from-violet-950/20 via-zinc-900/50 to-zinc-900/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-100">Agent Allocation</span>
          {agentRunning ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 flex items-center gap-1">
              <Activity className="w-3 h-3" /> AUTO
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-600/30 bg-zinc-700/20 text-zinc-500">
              MANUAL
            </span>
          )}
        </div>
        <button
          onClick={handleRebalance}
          disabled={rebalancing || !address}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
            bg-violet-600/20 border border-violet-500/30 text-violet-300
            hover:bg-violet-600/30 hover:text-violet-200 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {rebalancing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Rebalance Now
        </button>
      </div>

      {/* Drift indicator */}
      {hasCommitments && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span>Target vs Actual Allocation</span>
            {maxDrift > 10 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                Drift {maxDrift.toFixed(0)}%
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {driftData.map((d) => {
              const drift = d.actualPct - d.targetPct;
              const driftAbs = Math.abs(drift);
              const driftColor =
                driftAbs > 10
                  ? "text-amber-400"
                  : driftAbs > 5
                    ? "text-zinc-300"
                    : "text-emerald-400";
              return (
                <div
                  key={d.key}
                  className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <div className="text-[11px] text-zinc-400 mb-1">{d.label}</div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      {/* Target bar */}
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mb-0.5">
                        <span>Target</span>
                        <span className="font-medium text-zinc-300">{d.targetPct}%</span>
                      </div>
                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className={`h-full rounded-full ${d.color} opacity-40`} style={{ width: `${d.targetPct}%` }} />
                      </div>
                      {/* Actual bar */}
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-1 mb-0.5">
                        <span>Actual</span>
                        <span className="font-medium text-zinc-200">{d.actualPct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className={`h-full rounded-full ${d.color}`} style={{ width: `${d.actualPct}%` }} />
                      </div>
                    </div>
                    <span className={`text-[11px] font-medium ${driftColor}`}>
                      {drift > 0 ? "+" : ""}{drift.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rebalance result */}
      {rebalanceResult && (
        <div
          className={`text-xs px-3 py-2 rounded-lg border ${
            rebalanceResult.startsWith("Error")
              ? "border-red-500/20 bg-red-500/10 text-red-300"
              : rebalanceResult.includes("Drift")
                ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {rebalanceResult}
        </div>
      )}

      {/* Session key + agent status footer */}
      <div className="flex items-center justify-between text-[11px] text-zinc-500 border-t border-white/5 pt-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <KeyRound className="w-3 h-3" />
            {activeKeys.length > 0 ? (
              <span className="text-emerald-400">
                {activeKeys.length} active session key{activeKeys.length > 1 ? "s" : ""}
              </span>
            ) : (
              <span className="text-zinc-500">No session keys</span>
            )}
          </div>
          {agentState && (
            <div className="flex items-center gap-1">
              <Activity className="w-3 h-3" />
              <span className={agentRunning ? "text-emerald-400" : "text-zinc-500"}>
                Agent: {agentState.paused ? "paused" : agentState.state}
              </span>
              {agentState.actions_count != null && agentState.actions_count > 0 && (
                <span className="text-zinc-600">
                  ({agentState.actions_count} action{agentState.actions_count > 1 ? "s" : ""})
                </span>
              )}
            </div>
          )}
        </div>
        {!hasCommitments && (
          <span className="text-zinc-600">Deposit to see allocation targets</span>
        )}
      </div>
    </div>
  );
}

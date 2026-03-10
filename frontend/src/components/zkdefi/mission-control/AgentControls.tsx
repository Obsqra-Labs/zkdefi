"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  Square,
  AlertTriangle,
  ChevronDown,
  Key,
  Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

const POLL_MS = 15_000;

interface AgentStatus {
  state: string;
  running?: boolean;
  policy_name?: string;
}

interface Constraints {
  risk_tolerance?: number;
  venue_limits?: { venues?: string[]; ekubo_pct?: number; lending_pct?: number };
  privacy_mode?: string;
}

interface SessionKey {
  session_id: string;
  expires_at: string;
  is_active: boolean;
  is_expired?: boolean;
}

interface AgentControlsProps {
  address: string;
}

function timeRemaining(expiresAt: string): string {
  try {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch {
    return "—";
  }
}

export function AgentControls({ address }: AgentControlsProps) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [emergencyLoading, setEmergencyLoading] = useState(false);

  const [constraints, setConstraints] = useState<Constraints | null>(null);
  const [constraintsErr, setConstraintsErr] = useState<string | null>(null);
  const [constraintsOpen, setConstraintsOpen] = useState(false);

  const [sessionLine, setSessionLine] = useState<string>("—");
  const [sessionExpired, setSessionExpired] = useState(false);

  // --- Fetchers ---

  const fetchStatus = useCallback(async () => {
    try {
      const d = await apiFetch<AgentStatus>(
        `/api/v1/zkdefi/rebalancer/autonomous/status/${address}`,
      );
      setStatus(d);
      setStatusErr(null);
    } catch {
      setStatusErr("Status unavailable");
      setStatus(null);
    }
  }, [address]);

  const fetchConstraints = useCallback(async () => {
    try {
      const d = await apiFetch<Constraints>(`/api/v1/zkdefi/mc/constraints/${address}`);
      setConstraints(d);
      setConstraintsErr(null);
    } catch {
      setConstraintsErr("Constraints unavailable");
    }
  }, [address]);

  const fetchSession = useCallback(async () => {
    try {
      const d = await apiFetch<{ sessions?: SessionKey[] }>(
        `/api/v1/zkdefi/session_keys/list/${address}`,
      );
      const active = (d?.sessions ?? []).find((s) => s.is_active && !s.is_expired);
      if (active) {
        const remaining = timeRemaining(active.expires_at);
        const expired = remaining === "Expired";
        setSessionExpired(expired);
        setSessionLine(expired ? "Expired · renew" : `Active · ${remaining} remaining`);
      } else {
        setSessionLine("No session");
        setSessionExpired(true);
      }
    } catch {
      setSessionLine("—");
    }
  }, [address]);

  useEffect(() => {
    fetchStatus();
    fetchConstraints();
    fetchSession();
    const t = setInterval(() => { fetchStatus(); fetchSession(); }, POLL_MS);
    return () => clearInterval(t);
  }, [fetchStatus, fetchConstraints, fetchSession]);

  // --- Agent actions ---

  const agentAction = async (action: string) => {
    setActionLoading(true);
    try {
      await apiFetch(`/api/v1/zkdefi/rebalancer/autonomous/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      await fetchStatus();
    } catch {
      setStatusErr(`Failed to ${action}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEmergency = async () => {
    setEmergencyLoading(true);
    try {
      await apiFetch("/api/v1/zkdefi/mc/emergency/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      await fetchStatus();
    } catch {
      setStatusErr("Emergency stop failed");
    } finally {
      setEmergencyLoading(false);
    }
  };

  // --- Derived state ---

  const state = status?.state ?? "stopped";
  const isRunning = state === "running" || state === "monitoring";
  const isPaused = state === "paused";
  const dotColor = isRunning
    ? "bg-emerald-500"
    : isPaused
      ? "bg-amber-500"
      : state === "idle"
        ? "bg-cyan-500"
        : "bg-zinc-500";

  const constraintSummary = constraints
    ? `Risk: ${constraints.risk_tolerance ?? "—"}% · ${
        constraints.venue_limits?.venues?.join(", ") ?? "Ekubo"
      }`
    : null;

  return (
    <div className="w-[260px] flex-shrink-0 p-3 flex flex-col gap-3 overflow-y-auto">
      {/* 1 — Agent Status */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Agent</h3>
        {statusErr ? (
          <p className="text-[11px] text-red-400">{statusErr}</p>
        ) : (
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
            <span className="text-sm text-zinc-200 capitalize">{state}</span>
          </div>
        )}
        <div className="flex gap-1">
          {!isRunning && !isPaused && (
            <button
              onClick={() => agentAction("start")}
              disabled={actionLoading}
              className="p-1.5 rounded border border-emerald-700 hover:bg-emerald-900/40 text-emerald-400 disabled:opacity-50"
              title="Start"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {isRunning && (
            <button
              onClick={() => agentAction("pause")}
              disabled={actionLoading}
              className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
              title="Pause"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => agentAction("resume")}
              disabled={actionLoading}
              className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
              title="Resume"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {(isRunning || isPaused) && (
            <button
              onClick={() => agentAction("stop")}
              disabled={actionLoading}
              className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600 ml-1 self-center" />}
        </div>
      </section>

      {/* 2 — Emergency Stop */}
      <button
        onClick={handleEmergency}
        disabled={emergencyLoading}
        className="w-full py-2.5 rounded-lg font-semibold text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
      >
        <AlertTriangle className="w-4 h-4" />
        {emergencyLoading ? "Stopping…" : "EMERGENCY STOP"}
      </button>

      {/* 3 — Constraints Summary */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <button
          type="button"
          onClick={() => setConstraintsOpen((o) => !o)}
          className="w-full flex items-center justify-between"
        >
          <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Constraints</h3>
          <ChevronDown className={`w-3 h-3 text-zinc-600 transition-transform ${constraintsOpen ? "rotate-180" : ""}`} />
        </button>
        {constraintsErr ? (
          <p className="text-[10px] text-red-400 mt-1">{constraintsErr}</p>
        ) : constraintSummary && !constraintsOpen ? (
          <p className="text-[11px] text-zinc-400 mt-1 truncate">{constraintSummary}</p>
        ) : null}
        {constraintsOpen && constraints && (
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between text-zinc-500">
              <span>Risk tolerance</span>
              <span className="text-zinc-300">{constraints.risk_tolerance ?? "—"}%</span>
            </div>
            {constraints.venue_limits?.ekubo_pct != null && (
              <div className="flex justify-between text-zinc-500">
                <span>Ekubo</span>
                <span className="text-zinc-300">{constraints.venue_limits.ekubo_pct}%</span>
              </div>
            )}
            {constraints.venue_limits?.lending_pct != null && (
              <div className="flex justify-between text-zinc-500">
                <span>Lending</span>
                <span className="text-zinc-300">{constraints.venue_limits.lending_pct}%</span>
              </div>
            )}
            {constraints.privacy_mode && (
              <div className="flex justify-between text-zinc-500">
                <span>Privacy</span>
                <span className="text-zinc-300">{constraints.privacy_mode}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4 — Session Key Status */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-zinc-500" />
          <span className={`text-xs ${sessionExpired ? "text-amber-400" : "text-zinc-300"}`}>
            {sessionLine}
          </span>
        </div>
      </section>
    </div>
  );
}

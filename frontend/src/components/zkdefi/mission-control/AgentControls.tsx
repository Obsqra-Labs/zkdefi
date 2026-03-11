"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Play,
  Pause,
  Square,
  AlertTriangle,
  ChevronDown,
  Key,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { apiFetch, apiFetchAuth } from "@/lib/api/client";
import { DEMO_AGENT } from "@/lib/demoCapitalOS";

const POLL_MS = 15_000;

type RebalanceMode = "user" | "oracle";

interface AgentStatus {
  state: string;
  running?: boolean;
  policy_name?: string;
  checks_count?: number;
  actions_taken?: number;
  last_check?: string;
  last_action?: { type?: string; adapter?: string; timestamp?: string; tx_hash?: string };
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
  isDemo?: boolean;
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

export function AgentControls({ address, isDemo }: AgentControlsProps) {
  const [status, setStatus] = useState<AgentStatus | null>(
    isDemo ? DEMO_AGENT.status : null
  );
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [emergencyLoading, setEmergencyLoading] = useState(false);

  const [constraints, setConstraints] = useState<Constraints | null>(
    isDemo ? DEMO_AGENT.constraints : null
  );
  const [constraintsErr, setConstraintsErr] = useState<string | null>(null);
  const [constraintsOpen, setConstraintsOpen] = useState(false);

  const [sessionLine, setSessionLine] = useState<string>(
    isDemo ? `Active · ${DEMO_AGENT.session.expires_in} remaining` : "—"
  );
  const [sessionExpired, setSessionExpired] = useState(isDemo ? false : false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);

  const [rebalanceMode, setRebalanceMode] = useState<RebalanceMode>(
    isDemo ? DEMO_AGENT.rebalance_mode : "user"
  );
  const [rebalanceModeLoading, setRebalanceModeLoading] = useState(false);
  const [rebalanceModeErr, setRebalanceModeErr] = useState<string | null>(null);

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
        setActiveSessionId(expired ? null : active.session_id);
        setSessionLine(expired ? "Expired · renew" : `Active · ${remaining} remaining`);
      } else {
        setSessionLine("No session");
        setSessionExpired(true);
        setActiveSessionId(null);
      }
    } catch {
      setSessionLine("—");
      setActiveSessionId(null);
    }
  }, [address]);

  const fetchRebalanceMode = useCallback(async () => {
    try {
      const d = await apiFetch<{ rebalance_mode: RebalanceMode }>(
        `/api/v1/zkdefi/mc/rebalance-mode/${address}`,
      );
      setRebalanceMode(d.rebalance_mode);
      setRebalanceModeErr(null);
    } catch {
      setRebalanceModeErr("Mode unavailable");
    }
  }, [address]);

  useEffect(() => {
    if (isDemo) {
      // Actively set demo data when demo mode activates
      setStatus(DEMO_AGENT.status);
      setStatusErr(null);
      setConstraints(DEMO_AGENT.constraints);
      setConstraintsErr(null);
      setSessionLine(`Active · ${DEMO_AGENT.session.expires_in} remaining`);
      setSessionExpired(false);
      setRebalanceMode(DEMO_AGENT.rebalance_mode);
      setRebalanceModeErr(null);
      return;
    }
    fetchStatus();
    fetchConstraints();
    fetchSession();
    fetchRebalanceMode();
    const t = setInterval(() => { fetchStatus(); fetchSession(); }, POLL_MS);
    return () => clearInterval(t);
  }, [fetchStatus, fetchConstraints, fetchSession, fetchRebalanceMode, isDemo]);

  // --- Grant session key ---

  const grantSessionKey = async (): Promise<string | null> => {
    setGrantLoading(true);
    try {
      const res = await apiFetchAuth<{ session_id: string; calldata?: unknown }>(
        `/api/v1/zkdefi/session_keys/grant`,
        address,
        {
          method: "POST",
          body: JSON.stringify({
            owner_address: address,
            session_key_address: address,
            max_position: 5,
            allowed_protocols: ["pools", "ekubo", "lending", "staking"],
            duration_hours: 24,
          }),
        },
      );
      const sid = res?.session_id;
      if (sid) {
        // Auto-confirm (in production the wallet would sign the calldata first)
        await apiFetch(`/api/v1/zkdefi/session_keys/grant/confirm`, {
          method: "POST",
          body: JSON.stringify({ session_id: sid, tx_hash: `0x${Date.now().toString(16)}` }),
        });
        setActiveSessionId(sid);
        setSessionExpired(false);
        setSessionLine("Active · 24h remaining");
        return sid;
      }
    } catch (err: any) {
      const msg = err?.message ?? "unknown error";
      setSessionLine(`Grant failed: ${msg.slice(0, 60)}`);
      console.error("[AgentControls] grantSessionKey:", err);
    } finally {
      setGrantLoading(false);
    }
    return null;
  };

  // --- Agent actions ---

  const agentAction = async (action: string) => {
    setActionLoading(true);
    setStatusErr(null);
    try {
      if (action === "start") {
        // Ensure we have a session key; auto-grant if not
        let sid = activeSessionId;
        if (!sid) {
          sid = await grantSessionKey();
          if (!sid) {
            setStatusErr("Session key required — grant failed");
            setActionLoading(false);
            return;
          }
        }
        await apiFetchAuth(
          `/api/v1/zkdefi/rebalancer/autonomous/start`,
          address,
          {
            method: "POST",
            body: JSON.stringify({
              user_address: address,
              session_id: sid,
              interval_minutes: 15,
              risk_threshold: constraints?.risk_tolerance ?? 50,
            }),
          },
        );
      } else if (action === "stop") {
        await apiFetch(`/api/v1/zkdefi/rebalancer/autonomous/stop`, {
          method: "POST",
          body: JSON.stringify({ user_address: address }),
        });
      } else if (action === "pause") {
        await apiFetch(`/api/v1/zkdefi/rebalancer/autonomous/pause/${address}`, {
          method: "POST",
        });
      } else if (action === "resume") {
        await apiFetch(`/api/v1/zkdefi/rebalancer/autonomous/resume/${address}`, {
          method: "POST",
        });
      }
      await fetchStatus();
    } catch (err: any) {
      setStatusErr(`Failed to ${action}: ${err?.message ?? "unknown"}`);
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

  const handleRebalanceModeToggle = async (mode: RebalanceMode) => {
    const prev = rebalanceMode;
    setRebalanceMode(mode); // optimistic
    setRebalanceModeLoading(true);
    setRebalanceModeErr(null);
    try {
      await apiFetchAuth(
        `/api/v1/zkdefi/mc/rebalance-mode/${address}`,
        address,
        {
          method: "PUT",
          body: JSON.stringify({ rebalance_mode: mode }),
        },
      );
    } catch {
      setRebalanceMode(prev); // revert
      setRebalanceModeErr("Failed to update mode");
    } finally {
      setRebalanceModeLoading(false);
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
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span className="text-sm text-zinc-200 capitalize">{state}</span>
            </div>
            {isRunning && status?.checks_count != null && (
              <div className="flex gap-3 mb-2 text-[10px] text-zinc-500">
                <span>{status.checks_count} checks</span>
                <span>{status.actions_taken ?? 0} actions</span>
                {status.last_check && (
                  <span>Last: {new Date(status.last_check).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                )}
              </div>
            )}
            {status?.last_action && (
              <div className="text-[10px] text-zinc-600 mb-1 truncate">
                Last: {status.last_action.type ?? "deploy"} → {status.last_action.adapter ?? "—"}
              </div>
            )}
          </>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-zinc-500" />
            <span className={`text-xs ${sessionExpired ? "text-amber-400" : "text-zinc-300"}`}>
              {sessionLine}
            </span>
          </div>
          {(sessionExpired || !activeSessionId) && (
            <button
              onClick={grantSessionKey}
              disabled={grantLoading}
              className="text-[10px] px-2 py-1 rounded border border-violet-600/40 text-violet-400 hover:bg-violet-900/30 disabled:opacity-50 flex items-center gap-1"
            >
              {grantLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
              Grant
            </button>
          )}
        </div>
      </section>

      {/* 5 — Rebalance Mode Toggle */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Rebalance Mode</h3>
        {rebalanceModeErr ? (
          <p className="text-[10px] text-red-400">{rebalanceModeErr}</p>
        ) : null}
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-xs">
          {(["user", "oracle"] as RebalanceMode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleRebalanceModeToggle(m)}
              disabled={rebalanceModeLoading}
              className={`flex-1 px-3 py-1.5 text-center transition-colors ${
                rebalanceMode === m
                  ? "bg-emerald-600/30 text-emerald-300 font-semibold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              } disabled:opacity-50`}
            >
              {m === "user" ? "My Agent" : "Oracle"}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600 mt-1.5">
          {rebalanceMode === "user" ? "Only you can deploy/close pool capital." : "Oracle can rebalance with zkML verification."}
        </p>
      </section>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Play,
  Pause,
  Square,
  Settings,
  Shield,
  Key,
  ChevronRight,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { AgentRebalancer } from "@/components/zkdefi/AgentRebalancer";
import { SessionKeyManager } from "@/components/zkdefi/SessionKeyManager";

const POLL_INTERVAL_MS = 15000;

interface ControlPlaneProps {
  address: string | undefined;
  onOpenCircuitBoard?: () => void;
}

// --- Types ---

interface ExecutionState {
  emergency_pause?: boolean;
}

interface AgentStatus {
  state: string;
  running?: boolean;
  checks_completed?: number;
  actions_taken?: number;
  last_action_at?: string;
  next_check_at?: string;
  policy_name?: string;
  mode?: string;
}

interface Constraints {
  risk_tolerance: number;
  venue_limits?: {
    venues?: string[];
    max_position_pct?: number;
    ekubo_pct?: number;
    lending_pct?: number;
    staking_pct?: number;
  };
  privacy_mode?: string;
}

interface Reputation {
  tier?: number;
  tier_name?: string;
  trust_score?: number;
}

interface RiskPassport {
  tier?: number;
  tier_name?: string;
  composite_score?: number;
  credit_score?: number;
  letter_rating?: string;
  proof_receipts?: unknown[];
}

interface SessionKey {
  session_id: string;
  session_key: string;
  max_position: number;
  allowed_protocols: string[];
  duration_hours: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  is_expired?: boolean;
}

// --- Helpers ---

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}

function formatTimeRemaining(expiresAt: string | undefined): string {
  if (!expiresAt) return "—";
  try {
    const d = new Date(expiresAt);
    const now = Date.now();
    const diff = d.getTime() - now;
    if (diff <= 0) return "Expired";
    const h = Math.floor(diff / 3600_000);
    const m = Math.floor((diff % 3600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  } catch {
    return "—";
  }
}

// --- Section components ---

function Section({
  title,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-800 p-3 ${className}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-zinc-400" />
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

export function ControlPlane({ address, onOpenCircuitBoard }: ControlPlaneProps) {
  const [showRebalancer, setShowRebalancer] = useState(false);
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [emergencyPaused, setEmergencyPaused] = useState(false);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [constraints, setConstraints] = useState<Constraints | null>(null);
  const [constraintsLoading, setConstraintsLoading] = useState(false);
  const [constraintsDirty, setConstraintsDirty] = useState(false);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [passport, setPassport] = useState<RiskPassport | null>(null);
  const [sessions, setSessions] = useState<SessionKey[]>([]);

  // Local constraint edits (for controlled inputs)
  const [riskTolerance, setRiskTolerance] = useState(50);
  const [ekuboPct, setEkuboPct] = useState(40);
  const [lendingPct, setLendingPct] = useState(30);
  const [stakingPct, setStakingPct] = useState(30);
  const [privacyMode, setPrivacyMode] = useState("unlinkable_basic");

  const fetchExecution = useCallback(async () => {
    if (!address) return;
    try {
      const d = await apiFetch<{ steps?: { execution?: ExecutionState } }>(
        `/api/v1/zkdefi/mc/execution/current/${address}`
      );
      setEmergencyPaused(d?.steps?.execution?.emergency_pause ?? false);
    } catch {
      setEmergencyPaused(false);
    }
  }, [address]);

  const fetchAgent = useCallback(async () => {
    if (!address) return;
    try {
      const d = await apiFetch<AgentStatus>(
        `/api/v1/zkdefi/rebalancer/autonomous/status/${address}`
      );
      setAgentStatus(d);
    } catch {
      setAgentStatus({ state: "unavailable" });
    }
  }, [address]);

  const fetchConstraints = useCallback(async () => {
    if (!address) return;
    try {
      const d = await apiFetch<Constraints>(
        `/api/v1/zkdefi/mc/constraints/${address}`
      );
      setConstraints(d);
      setRiskTolerance(d.risk_tolerance ?? 50);
      setEkuboPct(d.venue_limits?.ekubo_pct ?? 40);
      setLendingPct(d.venue_limits?.lending_pct ?? 30);
      setStakingPct(d.venue_limits?.staking_pct ?? 30);
      setPrivacyMode(d.privacy_mode ?? "unlinkable_basic");
    } catch {
      setConstraints(null);
    } finally {
      setConstraintsLoading(false);
    }
  }, [address]);

  const fetchReputation = useCallback(async () => {
    if (!address) return;
    try {
      const d = await apiFetch<Reputation>(
        `/api/v1/zkdefi/reputation/user/${address}`
      );
      setReputation({
        tier: d.tier ?? 0,
        tier_name: String(d.tier_name ?? "Anon"),
        trust_score: d.trust_score ?? 0,
      });
    } catch {
      setReputation(null);
    }
  }, [address]);

  const fetchPassport = useCallback(async () => {
    if (!address) return;
    try {
      const d = await apiFetch<RiskPassport>(
        `/api/v1/zkdefi/risk_passport/user/${address}`
      );
      setPassport(d);
    } catch {
      setPassport(null);
    }
  }, [address]);

  const fetchSessions = useCallback(async () => {
    if (!address) return;
    try {
      const d = await apiFetch<{ sessions?: SessionKey[] }>(
        `/api/v1/zkdefi/session_keys/list/${address}`
      );
      setSessions(d?.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, [address]);

  // Emergency actions
  const handleEmergencyPause = async () => {
    setEmergencyLoading(true);
    try {
      await apiFetch("/api/v1/zkdefi/mc/emergency/pause", {
        method: "POST",
      });
      setEmergencyPaused(true);
    } catch {
      // ignore
    } finally {
      setEmergencyLoading(false);
    }
  };

  const handleEmergencyUnpause = async () => {
    setEmergencyLoading(true);
    try {
      await apiFetch("/api/v1/zkdefi/mc/emergency/unpause", {
        method: "POST",
      });
      setEmergencyPaused(false);
    } catch {
      // ignore
    } finally {
      setEmergencyLoading(false);
    }
  };

  // Agent actions
  const handlePauseAgent = async () => {
    if (!address) return;
    setAgentLoading(true);
    try {
      await apiFetch(`/api/v1/zkdefi/rebalancer/autonomous/pause/${address}`, {
        method: "POST",
      });
      await fetchAgent();
    } catch {
      // ignore
    } finally {
      setAgentLoading(false);
    }
  };

  const handleResumeAgent = async () => {
    if (!address) return;
    setAgentLoading(true);
    try {
      await apiFetch(`/api/v1/zkdefi/rebalancer/autonomous/resume/${address}`, {
        method: "POST",
      });
      await fetchAgent();
    } catch {
      // ignore
    } finally {
      setAgentLoading(false);
    }
  };

  const handleStopAgent = async () => {
    if (!address) return;
    setAgentLoading(true);
    try {
      await apiFetch("/api/v1/zkdefi/rebalancer/autonomous/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_address: address }),
      });
      await fetchAgent();
    } catch {
      // ignore
    } finally {
      setAgentLoading(false);
    }
  };

  // Constraints save
  const handleSaveConstraints = async () => {
    if (!address || !constraintsDirty) return;
    setConstraintsLoading(true);
    try {
      await apiFetch(`/api/v1/zkdefi/mc/constraints/${address}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          risk_tolerance: riskTolerance,
          venue_limits: {
            ...constraints?.venue_limits,
            max_position_pct: Math.max(ekuboPct, lendingPct, stakingPct),
            ekubo_pct: ekuboPct,
            lending_pct: lendingPct,
            staking_pct: stakingPct,
          },
          privacy_mode: privacyMode,
        }),
      });
      setConstraintsDirty(false);
      await fetchConstraints();
    } catch {
      // ignore
    } finally {
      setConstraintsLoading(false);
    }
  };

  // Sync local edits from fetched constraints
  useEffect(() => {
    if (constraints) {
      setRiskTolerance(constraints.risk_tolerance ?? 50);
      setEkuboPct(constraints.venue_limits?.ekubo_pct ?? 40);
      setLendingPct(constraints.venue_limits?.lending_pct ?? 30);
      setStakingPct(constraints.venue_limits?.staking_pct ?? 30);
      setPrivacyMode(constraints.privacy_mode ?? "unlinkable_basic");
    }
  }, [constraints]);

  // Polling
  useEffect(() => {
    fetchExecution();
    fetchAgent();
    if (address) {
      setConstraintsLoading(true);
      fetchConstraints();
    }
    fetchReputation();
    fetchPassport();
    fetchSessions();
  }, [
    address,
    fetchExecution,
    fetchAgent,
    fetchConstraints,
    fetchReputation,
    fetchPassport,
    fetchSessions,
  ]);

  useEffect(() => {
    const t = setInterval(() => {
      fetchExecution();
      fetchAgent();
      if (address) fetchConstraints();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [address, fetchExecution, fetchAgent, fetchConstraints]);

  const agentState = agentStatus?.state ?? "stopped";
  const agentRunning = agentState === "running" || agentState === "monitoring";
  const agentPaused = agentState === "paused";
  const proofCount = passport?.proof_receipts?.length ?? 0;
  const proofsRequired = 5;
  const activeSession = sessions.find((s) => s.is_active && !s.is_expired);

  return (
    <div className="w-[280px] flex-shrink-0 flex flex-col gap-3 p-3 overflow-y-auto">
      {/* 0. Emergency Stop */}
      <section
        className={`rounded-lg border p-3 transition-colors ${
          emergencyPaused
            ? "border-red-800/60 bg-red-950/40"
            : "border-zinc-800 bg-zinc-900/30"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle
            className={`w-4 h-4 ${emergencyPaused ? "text-red-400" : "text-zinc-400"}`}
          />
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Emergency Stop
          </h3>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span
            className={`text-sm font-medium ${
              emergencyPaused ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {emergencyPaused ? "PAUSED" : "ACTIVE"}
          </span>
        </div>
        <button
          onClick={emergencyPaused ? handleEmergencyUnpause : handleEmergencyPause}
          disabled={emergencyLoading}
          className="w-full py-2.5 rounded-lg font-semibold text-sm transition-colors bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {emergencyPaused ? "RESUME SYSTEM" : "EMERGENCY STOP"}
        </button>
      </section>

      {/* 1. Agent Status */}
      <Section title="Agent Status" icon={Play}>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                agentRunning
                  ? "bg-emerald-500"
                  : agentPaused
                    ? "bg-amber-500"
                    : "bg-zinc-500"
              }`}
            />
            <span className="text-zinc-200 capitalize">{agentState}</span>
          </div>
          {agentStatus?.policy_name && (
            <p className="text-zinc-400 truncate" title={agentStatus.policy_name}>
              {agentStatus.policy_name}
            </p>
          )}
          <div className="flex justify-between text-zinc-500">
            <span>Last action</span>
            <span>{formatRelativeTime(agentStatus?.last_action_at)}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Next check</span>
            <span>{formatRelativeTime(agentStatus?.next_check_at)}</span>
          </div>
          <div className="flex items-center gap-1 text-zinc-500">
            <span>Mode:</span>
            <span className="text-zinc-300">
              {agentStatus?.mode === "autonomous" ? "Autonomous" : "Assisted"}
            </span>
          </div>
          <div className="flex gap-1 pt-1">
            {agentRunning && (
              <button
                onClick={handlePauseAgent}
                disabled={agentLoading}
                className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                title="Pause"
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
            {agentPaused && (
              <button
                onClick={handleResumeAgent}
                disabled={agentLoading}
                className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                title="Resume"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            {agentRunning && (
              <button
                onClick={handleStopAgent}
                disabled={agentLoading}
                className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                title="Stop"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
            {agentPaused && (
              <button
                onClick={handleStopAgent}
                disabled={agentLoading}
                className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                title="Stop"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* 2. Constraints */}
      <Section title="Constraints" icon={Settings}>
        <div className="space-y-3 text-xs">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-zinc-500">Risk tolerance</span>
              <span className="text-zinc-300">{riskTolerance}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={riskTolerance}
              onChange={(e) => {
                setRiskTolerance(Number(e.target.value));
                setConstraintsDirty(true);
              }}
              className="w-full h-1.5 rounded-full appearance-none bg-zinc-800 accent-emerald-500"
            />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-zinc-500">Ekubo</span>
              <span className="text-zinc-300">{ekuboPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={ekuboPct}
              onChange={(e) => {
                setEkuboPct(Number(e.target.value));
                setConstraintsDirty(true);
              }}
              className="w-full h-1.5 rounded-full appearance-none bg-zinc-800 accent-cyan-500"
            />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-zinc-500">Lending</span>
              <span className="text-zinc-300">{lendingPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={lendingPct}
              onChange={(e) => {
                setLendingPct(Number(e.target.value));
                setConstraintsDirty(true);
              }}
              className="w-full h-1.5 rounded-full appearance-none bg-zinc-800 accent-violet-500"
            />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-zinc-500">Staking</span>
              <span className="text-zinc-300">{stakingPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={stakingPct}
              onChange={(e) => {
                setStakingPct(Number(e.target.value));
                setConstraintsDirty(true);
              }}
              className="w-full h-1.5 rounded-full appearance-none bg-zinc-800 accent-amber-500"
            />
          </div>
          <div>
            <label className="text-zinc-500 block mb-1">Privacy mode</label>
            <select
              value={privacyMode}
              onChange={(e) => {
                setPrivacyMode(e.target.value);
                setConstraintsDirty(true);
              }}
              className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs"
            >
              <option value="unlinkable_basic">Unlinkable Basic</option>
              <option value="hidden_flow">Hidden Flow</option>
              <option value="hashed_claims">Hashed Claims</option>
            </select>
          </div>
          <div className="flex gap-2">
            {constraintsDirty && (
              <button
                onClick={handleSaveConstraints}
                disabled={constraintsLoading}
                className="flex-1 py-1.5 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            )}
            {onOpenCircuitBoard && (
              <button
                onClick={onOpenCircuitBoard}
                className={`py-1.5 text-xs font-medium rounded border border-zinc-700 hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1 ${constraintsDirty ? "flex-1" : "w-full"}`}
              >
                Edit in Circuit Board
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* 3. Risk Passport Summary */}
      <Section title="Risk Passport" icon={Shield}>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                (reputation?.tier ?? 0) === 0
                  ? "bg-zinc-700 text-zinc-300"
                  : (reputation?.tier ?? 0) === 1
                    ? "bg-emerald-900/50 text-emerald-400"
                    : "bg-amber-900/50 text-amber-400"
              }`}
            >
              {reputation?.tier_name ?? passport?.tier_name ?? "Anon"}
            </span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Trust</span>
            <span className="text-zinc-300">{reputation?.trust_score ?? "—"}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>FICO</span>
            <span className="text-zinc-300">
              {passport?.credit_score ?? passport?.composite_score ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Proofs</span>
            <span className="flex items-center gap-0.5">
              {Array.from({ length: proofsRequired }).map((_, i) => (
                <span
                  key={i}
                  className={
                    i < proofCount
                      ? "text-emerald-400"
                      : "text-zinc-600"
                  }
                >
                  {i < proofCount ? "●" : "○"}
                </span>
              ))}
              <span className="ml-1 text-zinc-500">
                {proofCount}/{proofsRequired}
              </span>
            </span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Voting power</span>
            <span className="text-zinc-300">—</span>
          </div>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs mt-1"
          >
            View Full Profile
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </Section>

      {/* 4. Session Key */}
      <Section title="Session Key" icon={Key}>
        <div className="space-y-2 text-xs">
          {activeSession ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-zinc-200">Active</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Time remaining</span>
                <span className="text-zinc-300">
                  {formatTimeRemaining(activeSession.expires_at)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Scope</span>
                <span className="text-zinc-300 truncate max-w-[140px]" title={activeSession.allowed_protocols?.join(", ")}>
                  {activeSession.allowed_protocols?.join(", ") ?? "—"}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-zinc-500" />
                <span className="text-zinc-400">No active session</span>
              </div>
            </>
          )}
          <button
            onClick={() => setShowSessionManager(!showSessionManager)}
            className="w-full py-1.5 text-xs font-medium rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            {showSessionManager ? "Hide" : "Manage Sessions"}
          </button>
          {showSessionManager && address && (
            <div className="mt-2 -mx-3 px-1">
              <SessionKeyManager
                userAddress={address}
                onSessionGranted={fetchSessions}
              />
            </div>
          )}
        </div>
      </Section>

      {/* 5. Agent Rebalancer (expandable) */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <button
          onClick={() => setShowRebalancer(!showRebalancer)}
          className="w-full flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider hover:text-zinc-200 transition-colors"
        >
          <Play className="w-4 h-4" />
          <span>Agent Rebalancer</span>
          <ChevronRight className={`w-3 h-3 ml-auto transition-transform ${showRebalancer ? "rotate-90" : ""}`} />
        </button>
        {showRebalancer && address && (
          <div className="mt-3 -mx-3 px-1">
            <AgentRebalancer userAddress={address} />
          </div>
        )}
      </section>
    </div>
  );
}

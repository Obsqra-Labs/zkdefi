"use client";

import { Shield, Cpu, Wallet, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { useExecutionContext } from "@/hooks/useExecutionContext";
import { useVaultPolicy } from "@/hooks/useVaultPolicy";
import { compilePreview } from "@/lib/api/gating";
import { toastError, toastSuccess } from "@/lib/toast";
import { TRACK_A_LABEL, TRACK_B_LABEL } from "@/lib/vaultTracks";

const GLOBAL_EXEC_RAIL = (process.env.NEXT_PUBLIC_GLOBAL_EXEC_RAIL ?? "true").toLowerCase() !== "false";
import { API_BASE } from "@/lib/api/client";
const DEV_STATE_RESET_ENABLED =
  (process.env.NEXT_PUBLIC_DEV_STATE_RESET_ENABLED ?? "true").toLowerCase() !== "false";

interface ExecutionControlRailProps {
  address?: string;
  compact?: boolean;
  gateMode?: "balanced" | "stress";
  onGateModeChange?: (next: "balanced" | "stress") => void;
  autopilotEnabled?: boolean;
  onAutopilotEnabledChange?: (next: boolean) => void;
  autopilotMinSpreadBps?: number;
  onAutopilotMinSpreadBpsChange?: (next: number) => void;
  manualWalletOverrideEnabled?: boolean;
  onManualWalletOverrideEnabledChange?: (next: boolean) => void;
  manualOverrideMinPassportScore?: number;
  onManualOverrideMinPassportScoreChange?: (next: number) => void;
}

export function ExecutionControlRail({
  address,
  compact = false,
  gateMode,
  onGateModeChange,
  autopilotEnabled,
  onAutopilotEnabledChange,
  autopilotMinSpreadBps,
  onAutopilotMinSpreadBpsChange,
  manualWalletOverrideEnabled,
  onManualWalletOverrideEnabledChange,
  manualOverrideMinPassportScore,
  onManualOverrideMinPassportScoreChange,
}: ExecutionControlRailProps) {
  const ctx = useExecutionContext(address);
  const { policy } = useVaultPolicy(address);
  const [policyHash, setPolicyHash] = useState<string | null>(null);

  const [internalGateMode, setInternalGateMode] = useState<"balanced" | "stress">("balanced");
  const [internalAutopilot, setInternalAutopilot] = useState(false);
  const [internalAutopilotBps, setInternalAutopilotBps] = useState(20);
  const [internalManualOverride, setInternalManualOverride] = useState(true);
  const [internalManualMin, setInternalManualMin] = useState(20);
  const [resetting, setResetting] = useState(false);

  const selectedGateMode = gateMode ?? internalGateMode;
  const selectedAutopilot = autopilotEnabled ?? internalAutopilot;
  const selectedAutopilotBps = autopilotMinSpreadBps ?? internalAutopilotBps;
  const selectedManualOverride = manualWalletOverrideEnabled ?? internalManualOverride;
  const selectedManualMin = manualOverrideMinPassportScore ?? internalManualMin;

  const setGateMode = onGateModeChange ?? setInternalGateMode;
  const setAutopilot = onAutopilotEnabledChange ?? setInternalAutopilot;
  const setAutopilotBps = onAutopilotMinSpreadBpsChange ?? setInternalAutopilotBps;
  const setManualOverride = onManualWalletOverrideEnabledChange ?? setInternalManualOverride;
  const setManualMin = onManualOverrideMinPassportScoreChange ?? setInternalManualMin;

  useEffect(() => {
    if (!address) {
      setPolicyHash(null);
      return;
    }
    let cancelled = false;
    compilePreview({
      user_address: address,
      action_type: "deposit",
      execution_intent: "manual_wallet",
      wallet_connected: true,
    })
      .then((res) => {
        if (!cancelled) setPolicyHash(res.effective_policy_hash);
      })
      .catch(() => {
        if (!cancelled) setPolicyHash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, policy?.updated_at]);

  if (!GLOBAL_EXEC_RAIL) return null;

  const handleResetState = async () => {
    if (!address || resetting) return;
    setResetting(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/policy/reset/${encodeURIComponent(address)}`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.detail === "string" ? payload.detail : "Reset failed");
      }
      toastSuccess("Backend test state reset for this wallet. Re-run onboarding.");
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const decisionBadgeClass = (mode: "allow" | "advisory" | "block" | "unknown") => {
    if (mode === "allow") return "border-emerald-600/40 bg-emerald-500/10 text-emerald-300";
    if (mode === "advisory") return "border-amber-600/40 bg-amber-500/10 text-amber-300";
    if (mode === "block") return "border-rose-600/40 bg-rose-500/10 text-rose-300";
    return "border-zinc-700 bg-zinc-800 text-zinc-400";
  };
  const shortHex = (value?: string | null) => {
    if (!value) return "--";
    if (value.length < 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
  };

  return (
    <div className="glass rounded-xl border border-zinc-800 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          Execution Control
        </h3>
        <span className="text-[11px] text-zinc-500">
          {ctx.infra.status.walletProvider}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-2">
          <p className="text-zinc-500">Passport</p>
          <p className="text-zinc-200 font-medium">
            {ctx.passportScore ?? "—"} ({ctx.passportTier})
          </p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-2">
          <p className="text-zinc-500">Sessions</p>
          <p className="text-zinc-200 font-medium">{ctx.activeSessionCount}</p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-2 col-span-2">
          <p className="text-zinc-500">Dual Wallet Session</p>
          <p className={`font-medium ${ctx.dualWalletLinked ? "text-emerald-300" : "text-zinc-200"}`}>
            {ctx.dualWalletLinked
              ? `${shortHex(ctx.dualWalletAddress)} • ${ctx.dualWalletChain || "ethereum"}`
              : "Not linked (Starknet only)"}
          </p>
          <p className="text-[11px] text-zinc-500">
            {ctx.dualWalletLinked
              ? "Cross-chain identity link available for trust and reputation context."
              : "Link an EVM wallet in Connect Wallet to strengthen cross-chain trust context."}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-2">
          <p className="text-zinc-500">Compliance</p>
          <p className="text-zinc-200 font-medium">{ctx.complianceProfileCount} profiles</p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-2">
          <p className="text-zinc-500">Gas Mode</p>
          <select
            value={ctx.infra.status.gasMode}
            onChange={(event) => ctx.infra.setGasMode(event.target.value as "auto" | "wallet" | "paymaster")}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200"
          >
            <option value="auto">Auto</option>
            <option value="wallet">Wallet</option>
            <option value="paymaster">Paymaster</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-2 mb-3 text-xs">
        <p className="text-zinc-500 mb-1">Trust decisions</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded border ${decisionBadgeClass(ctx.relayerDecisionMode)}`}>
            Relayer: {ctx.relayerDecisionMode}
          </span>
          <span className={`px-2 py-0.5 rounded border ${decisionBadgeClass(ctx.executionDecisionMode)}`}>
            Execution: {ctx.executionDecisionMode}
          </span>
          <span className={`px-2 py-0.5 rounded border ${decisionBadgeClass(ctx.lendingDecisionMode)}`}>
            Lending: {ctx.lendingDecisionMode}
          </span>
        </div>
        {ctx.decisionReasons.length > 0 && (
          <p className="text-zinc-500 mt-1">
            Reasons: {ctx.decisionReasons.slice(0, 4).join(", ")}
          </p>
        )}
        <p className="text-zinc-500 mt-1">
          Identity linkage: {ctx.dualWalletLinked ? `linked (${ctx.dualWalletStatus})` : `not linked (${ctx.dualWalletStatus})`}
        </p>
      </div>

      {policy && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-2 mb-3 text-xs">
          <p className="text-zinc-500">Policy</p>
          <p className="text-zinc-200 font-medium">
            {policy.execution_policy?.mode ?? "—"} • {policy.privacy_policy?.preset ?? "—"}
          </p>
          {policyHash && (
            <p className="text-zinc-500">hash {policyHash.slice(0, 12)}...</p>
          )}
          <p className="text-zinc-500">
            {policy.shared_pool_context?.shared_pool_id
              ? `${TRACK_B_LABEL} — Shared pool ${policy.shared_pool_context.shared_pool_id}`
              : `${TRACK_A_LABEL} — Personal vault profile`}
          </p>
        </div>
      )}

      {!compact && (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <div className="flex items-center gap-2 text-xs">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-zinc-400">Gate mode</span>
            <button
              type="button"
              onClick={() => setGateMode("balanced")}
              className={`px-2 py-0.5 rounded border ${
                selectedGateMode === "balanced"
                  ? "bg-emerald-600/20 border-emerald-600/40 text-emerald-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              Balanced
            </button>
            <button
              type="button"
              onClick={() => setGateMode("stress")}
              className={`px-2 py-0.5 rounded border ${
                selectedGateMode === "stress"
                  ? "bg-amber-600/20 border-amber-600/40 text-amber-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              Stress
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Rocket className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-zinc-400">Autopilot</span>
            <button
              type="button"
              onClick={() => setAutopilot(!selectedAutopilot)}
              className={`px-2 py-0.5 rounded border ${
                selectedAutopilot
                  ? "bg-cyan-600/20 border-cyan-600/40 text-cyan-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              {selectedAutopilot ? "On" : "Off"}
            </button>
            <input
              type="number"
              min={1}
              max={500}
              value={selectedAutopilotBps}
              onChange={(event) =>
                setAutopilotBps(Math.max(1, Math.min(500, Number(event.target.value) || 20)))
              }
              className="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-200"
            />
            <span className="text-zinc-500">bps</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Wallet className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-zinc-400">Manual override</span>
            <button
              type="button"
              onClick={() => setManualOverride(!selectedManualOverride)}
              className={`px-2 py-0.5 rounded border ${
                selectedManualOverride
                  ? "bg-violet-600/20 border-violet-600/40 text-violet-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              {selectedManualOverride ? "On" : "Off"}
            </button>
            <input
              type="number"
              min={0}
              max={100}
              value={selectedManualMin}
              onChange={(event) =>
                setManualMin(Math.max(0, Math.min(100, Number(event.target.value) || 0)))
              }
              className="w-14 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-200"
            />
            <span className="text-zinc-500">passport min</span>
          </div>
        </div>
      )}

      {ctx.infra.status.fallbackUsed && (
        <p className="text-[11px] text-amber-300 mt-2">
          Paymaster fallback: {ctx.infra.status.lastFallbackReason || "wallet gas used"}
        </p>
      )}

      {ctx.disclosureDisclaimer && (
        <p className="text-[11px] text-zinc-500 mt-2">{ctx.disclosureDisclaimer}</p>
      )}

      {!compact && DEV_STATE_RESET_ENABLED && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={handleResetState}
            disabled={!address || resetting}
            className="w-full px-3 py-2 rounded-lg text-xs border border-rose-700/40 text-rose-300 hover:bg-rose-900/20 disabled:opacity-50"
          >
            {resetting ? "Resetting..." : "Reset backend test state"}
          </button>
        </div>
      )}
    </div>
  );
}

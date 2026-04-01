"use client";

/**
 * SignalExecutionDrawer — Phase D completion.
 *
 * When the user clicks a signal/opportunity in OracleDashboardStrip,
 * this drawer opens with:
 *  1. Signal details (name, APY, risk, genome)
 *  2. Execution parameters (amount, slippage, privacy level)
 *  3. Simulation preview (estimated gas, impact)
 *  4. "Execute" button → POST /oracle/execute → live status polling
 *  5. Confirmation state on success
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Play,
  Shield,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  apiFetch,
  apiFetchAuth,
  getApiErrorMessage,
  getTrustGateErrorDetail,
  type TrustGateErrorDetail,
} from "@/lib/api/client";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { toastSuccess, toastError } from "@/lib/toast";
import { useAccount } from "@starknet-react/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalForExecution {
  id: string;
  name: string;
  suggestedAmount?: number;
  suggestedPrivacyLevel?: "public" | "shielded" | "full";
  type?: string;
  venue?: string;
  currentYield?: number;
  apy_bps?: number;
  riskScore?: number;
  risk_level?: string;
  signal?: string;
  signal_strength?: number;
  signal_reason?: string;
  constitution?: Record<string, unknown>;
  predictions?: Record<string, unknown>;
}

interface SimulationResult {
  call_id: string;
  adapter: string;
  method: string;
  estimated_gas: number | null;
  estimated_cost_eth: number | null;
  estimation_unavailable?: boolean;
}

interface ExecutionResult {
  success: boolean;
  call_id: string;
  tx_hash: string | null;
  status: string;
  submitted_at?: string;
  signal_id: string;
  wallet_calldata?: {
    adapter: string;
    method: string;
    calldata: Record<string, unknown>;
    estimated_gas?: number;
  };
  gate_context?: {
    source?: string;
    requires_lending_gate?: boolean;
    execution?: {
      mode?: string;
      reason_codes?: string[];
      reason_hints?: string[];
    };
    lending?: {
      mode?: string;
      reason_codes?: string[];
      reason_hints?: string[];
    } | null;
  };
}

interface ExecutionPollResult {
  call_id: string;
  status: string;
  error?: string | null;
  reason?: string | null;
  reason_codes?: string[];
  reason_hints?: string[];
}

interface Props {
  signal: SignalForExecution | null;
  address: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIVACY_LEVELS = [
  { id: "public", label: "Public", desc: "Standard execution" },
  { id: "shielded", label: "Shielded", desc: "Commitment-based privacy" },
  { id: "full", label: "Full Privacy", desc: "Nullifier + Merkle proof" },
] as const;

const RISK_COLORS: Record<string, string> = {
  low: "text-emerald-400",
  safe: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
  elevated: "text-red-400",
};

function riskLabel(score?: number, level?: string): { text: string; color: string } {
  if (level) return { text: level, color: RISK_COLORS[level] ?? "text-zinc-400" };
  if (score == null) return { text: "Unknown", color: "text-zinc-400" };
  if (score <= 35) return { text: "Low", color: "text-emerald-400" };
  if (score <= 65) return { text: "Medium", color: "text-amber-400" };
  return { text: "High", color: "text-red-400" };
}

function apyFromSignal(s: SignalForExecution): number {
  if (s.currentYield) return s.currentYield;
  if (s.apy_bps) return s.apy_bps / 100;
  return 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SignalExecutionDrawer({ signal, address, onClose }: Props) {
  const { account } = useAccount();
  const [amount, setAmount] = useState("100");
  const [slippage, setSlippage] = useState("50");
  const [privacyLevel, setPrivacyLevel] = useState<string>("public");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [pollStatus, setPollStatus] = useState<string | null>(null);
  const [pollReason, setPollReason] = useState<string | null>(null);
  const [gateError, setGateError] = useState<TrustGateErrorDetail | null>(null);

  // Reset state when signal changes
  useEffect(() => {
    setSimulation(null);
    setResult(null);
    setPollStatus(null);
    setPollReason(null);
    setGateError(null);
    const nextAmount = signal?.suggestedAmount && Number.isFinite(signal.suggestedAmount)
      ? String(signal.suggestedAmount)
      : "100";
    setAmount(nextAmount);
    setPrivacyLevel(signal?.suggestedPrivacyLevel ?? "public");
  }, [signal?.id]);

  // ---- Simulate ----
  const handleSimulate = useCallback(async () => {
    if (!signal || !address) return;
    setSimulating(true);
    setSimulation(null);
    try {
      const res = await apiFetchAuth<{ simulation: SimulationResult }>(
        `/api/v1/zkdefi/oracle/execution/simulate?address=${encodeURIComponent(address)}`,
        address,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signal,
            execution_params: {
              amount: parseFloat(amount) || 0,
              slippage: parseInt(slippage) || 50,
              privacyLevel,
            },
          }),
        },
      );
      setSimulation(res.simulation);
    } catch {
      // Mark simulation as unavailable rather than faking gas numbers
      setSimulation({
        call_id: "sim-preview",
        adapter: signal.type ?? "unknown",
        method: "execute",
        estimated_gas: null,
        estimated_cost_eth: null,
        estimation_unavailable: true,
      });
    } finally {
      setSimulating(false);
    }
  }, [signal, address, amount, slippage, privacyLevel]);

  // Auto-simulate on mount
  useEffect(() => {
    if (signal) handleSimulate();
  }, [signal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Execute ----
  const handleExecute = useCallback(async () => {
    if (!signal || !address) return;
    setExecuting(true);
    setGateError(null);
    try {
      const res = await apiFetchAuth<ExecutionResult>(
        `/api/v1/zkdefi/oracle/execute?address=${encodeURIComponent(address)}`,
        address,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signal,
            execution_params: {
              amount: parseFloat(amount) || 0,
              slippage: parseInt(slippage) || 50,
              privacyLevel,
            },
          }),
        },
      );

      // If relayer unavailable, sign with wallet directly
      if (res.status === "wallet_sign_required" && res.wallet_calldata && account) {
        const cd = res.wallet_calldata;
        const PROOF_GATED_AGENT = process.env.NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS || "";
        const walletResult = await account.execute([{
          contractAddress: PROOF_GATED_AGENT,
          entrypoint: cd.method,
          calldata: Object.values(cd.calldata).map(String),
        }]);
        const finalResult: ExecutionResult = {
          ...res,
          tx_hash: walletResult.transaction_hash,
          status: "pending",
        };
        setResult(finalResult);
        toastSuccess(`Execution submitted — ${walletResult.transaction_hash.slice(0, 12)}…`);
      } else {
        setResult(res);
        toastSuccess(`Execution submitted — ${res.tx_hash?.slice(0, 12) ?? res.call_id?.slice(0, 12)}…`);
      }
    } catch (err: unknown) {
      const detail = getTrustGateErrorDetail(err);
      if (detail) {
        setGateError(detail);
      }
      const msg = getApiErrorMessage(err);
      toastError(`Execution failed: ${msg}`);
    } finally {
      setExecuting(false);
    }
  }, [signal, address, amount, slippage, privacyLevel, account]);

  // ---- Poll status after execution ----
  useEffect(() => {
    if (!result?.call_id) return;
    let dead = false;

    const terminal = new Set(["confirmed", "failed", "aborted", "cancelled", "rejected", "not_found"]);

    const poll = async () => {
      try {
        const res = await apiFetch<ExecutionPollResult>(
          `/api/v1/zkdefi/oracle/execution/${result.call_id}`,
        );
        if (dead) return;
        setPollStatus(res.status);
        const reason =
          (res.reason && res.reason.trim()) ||
          (res.error && res.error.trim()) ||
          (Array.isArray(res.reason_hints) && res.reason_hints.length > 0 ? res.reason_hints.join("; ") : "") ||
          (Array.isArray(res.reason_codes) && res.reason_codes.length > 0 ? res.reason_codes.join(", ") : "") ||
          null;
        setPollReason(reason);
      } catch {
        // noop
      }
    };

    poll();
    const id = setInterval(async () => {
      await poll();
      if (!dead && pollStatus && terminal.has(pollStatus)) {
        clearInterval(id);
      }
    }, 5000);

    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [result?.call_id, pollStatus]);

  if (!signal) return null;

  const apy = apyFromSignal(signal);
  const risk = riskLabel(signal.riskScore, signal.risk_level);
  const amountNum = parseFloat(amount) || 0;

  const currentStatus = pollStatus ?? result?.status ?? "pending";
  const isTerminalFailure = ["failed", "aborted", "cancelled", "rejected", "not_found"].includes(currentStatus);

  // Completed state
  if (result) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Execution Submitted</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-900/20 via-zinc-900/80 to-zinc-900/80 p-5 space-y-4"
        >
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
              <Check className="w-7 h-7 text-white" strokeWidth={3} />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-white">Signal Executed</h3>
              <p className="text-sm text-zinc-400 mt-1">{signal.name}</p>
              <p className="text-2xl font-semibold text-white mt-2">
                {amountNum} <span className="text-base text-zinc-400">STRK</span>
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-2 text-xs">
            {result.tx_hash && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Transaction</span>
                <a
                  href={sepoliaVoyagerTxUrl(result.tx_hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono"
                >
                  {result.tx_hash.slice(0, 12)}…
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Call ID</span>
              <span className="text-zinc-300 font-mono">{result.call_id?.slice(0, 14)}…</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Status</span>
              <span className={`flex items-center gap-1.5 ${
                currentStatus === "confirmed" ? "text-emerald-400" :
                isTerminalFailure ? "text-red-400" :
                "text-amber-400"
              }`}>
                {!isTerminalFailure && currentStatus !== "confirmed" && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                {currentStatus === "confirmed" && <Check className="w-3 h-3" />}
                {currentStatus}
              </span>
            </div>
            {isTerminalFailure && (
              <div className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                {pollReason || "Execution was aborted by relayer/policy without additional detail."}
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Privacy</span>
              <span className="text-zinc-300 capitalize">{privacyLevel}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full rounded-lg py-3 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Done
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Execute Signal</h2>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Signal details */}
      <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-b from-cyan-900/10 via-zinc-900/60 to-zinc-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">{signal.name}</h3>
            {signal.venue && <p className="text-[11px] text-zinc-500">{signal.venue}</p>}
          </div>
          <div className="text-right">
            <span className="text-lg font-bold text-cyan-400">{apy.toFixed(1)}%</span>
            <p className="text-[11px] text-zinc-500">APY</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className={`flex items-center gap-1 ${risk.color}`}>
            <Shield className="w-3 h-3" />
            Risk: {risk.text}
          </span>
          {signal.signal && (
            <span className="flex items-center gap-1 text-violet-400">
              <Zap className="w-3 h-3" />
              {signal.signal.replace("_", " ")}
            </span>
          )}
          {signal.signal_strength != null && (
            <span className="text-zinc-500">
              Strength: {Math.round(signal.signal_strength)}%
            </span>
          )}
        </div>

        {signal.signal_reason && (
          <p className="text-[11px] text-zinc-500 leading-relaxed">{signal.signal_reason}</p>
        )}
      </div>

      {/* Execution parameters */}
      <div className="space-y-3">
        <h4 className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">
          Execution Parameters
        </h4>

        {/* Amount */}
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Amount (STRK)</label>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-white text-lg placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
            placeholder="0.00"
          />
        </div>

        {/* Privacy level */}
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">Privacy Level</label>
          <div className="flex gap-2">
            {PRIVACY_LEVELS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPrivacyLevel(p.id)}
                className={`flex-1 rounded-lg border p-2.5 text-center transition-colors ${
                  privacyLevel === p.id
                    ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                    : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20"
                }`}
              >
                <span className="text-xs font-medium block">{p.label}</span>
                <span className="text-[10px] text-zinc-500 block mt-0.5">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          Advanced
        </button>

        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Slippage (bps)</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/40"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Simulation preview */}
      {simulation && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-2"
        >
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Zap className="w-3 h-3" />
            <span className="font-medium">Simulation Preview</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-zinc-500">Adapter</span>
              <p className="text-zinc-200 capitalize">{simulation.adapter}</p>
            </div>
            <div>
              <span className="text-zinc-500">Method</span>
              <p className="text-zinc-200">{simulation.method}</p>
            </div>
            <div>
              <span className="text-zinc-500">Est. Gas</span>
              <p className="text-zinc-200">{simulation.estimated_gas != null ? simulation.estimated_gas.toLocaleString() : <span className="text-amber-400 text-[10px]">unavailable</span>}</p>
            </div>
            <div>
              <span className="text-zinc-500">Est. Cost</span>
              <p className="text-zinc-200">{simulation.estimated_cost_eth != null ? `${simulation.estimated_cost_eth.toFixed(6)} ETH` : <span className="text-amber-400 text-[10px]">unavailable</span>}</p>
            </div>
          </div>
          {amountNum > 0 && apy > 0 && (
            <div className="pt-1 border-t border-white/5 flex items-center justify-between text-xs">
              <span className="text-zinc-500">Projected yearly return</span>
              <span className="text-emerald-400 font-medium">
                +{(amountNum * apy / 100).toFixed(2)} STRK
              </span>
            </div>
          )}
        </motion.div>
      )}

      {simulating && !simulation && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Simulating execution…
        </div>
      )}

      {/* Policy warning */}
      {amountNum > 10000 && (
        <div className="flex items-start gap-2 text-xs text-amber-400 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Large execution — policy gating may require additional verification.</span>
        </div>
      )}

      {gateError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 space-y-2">
          <div className="flex items-start gap-2 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">{gateError.error ?? "Blocked by trust gate"}</p>
              <p className="text-[11px] text-red-200/80">
                {gateError.gate ? `Gate: ${gateError.gate}` : "Gate decision unavailable"}
                {gateError.source ? ` · ${gateError.source}` : ""}
              </p>
            </div>
          </div>
          {Array.isArray(gateError.decision?.reason_hints) && gateError.decision.reason_hints.length > 0 ? (
            <div className="space-y-1">
              {gateError.decision.reason_hints.map((hint) => (
                <p key={hint} className="text-xs text-red-100/90">• {hint}</p>
              ))}
            </div>
          ) : Array.isArray(gateError.decision?.reason_codes) && gateError.decision.reason_codes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {gateError.decision.reason_codes.map((code) => (
                <span
                  key={code}
                  className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-100"
                >
                  {code}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Execute button */}
      <button
        disabled={executing || amountNum <= 0}
        onClick={handleExecute}
        className={`w-full rounded-lg py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
          executing || amountNum <= 0
            ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            : "bg-gradient-to-r from-cyan-600 to-cyan-700 text-white hover:from-cyan-500 hover:to-cyan-600 shadow-lg shadow-cyan-900/30"
        }`}
      >
        {executing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Executing…
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            Execute Signal
            {amountNum > 0 && <span className="text-cyan-200/70 ml-1">• {amountNum} STRK</span>}
          </>
        )}
      </button>

      {/* Re-simulate link */}
      <button
        onClick={handleSimulate}
        disabled={simulating}
        className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {simulating ? "Simulating…" : "Re-simulate with current params"}
      </button>
    </div>
  );
}

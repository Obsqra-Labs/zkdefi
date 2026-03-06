"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/api/client";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  ChevronDown,
  ChevronUp,
  Brain,
  Fingerprint,
} from "lucide-react";



/* ── Types ─────────────────────────────────────────────────────── */

interface ProofResult {
  is_compliant?: boolean;
  is_safe?: boolean;
  risk_score?: number;
  anomaly_flag?: number;
  proof_hash?: string;
  groth16_proof_hash?: string;
  commitment_hash?: string;
  proof_calldata?: number[];
  snapshot_hash?: string;
}

interface CombinedResult {
  can_proceed: boolean;
  risk_compliant: boolean;
  pool_safe: boolean;
  can_rebalance: boolean;
  commitment_hash: string;
  snapshot_hash: string | null;
  risk_proof: ProofResult;
  anomaly_proof: ProofResult;
  combined_calldata: {
    risk_calldata: number[];
    anomaly_calldata: number[];
  };
}

type CardState = "idle" | "loading" | "success" | "error";

/* ── Helpers ───────────────────────────────────────────────────── */

function truncHash(hash: string | undefined | null, len = 10): string {
  if (!hash) return "—";
  if (hash.length <= len + 4) return hash;
  return `${hash.slice(0, len)}…${hash.slice(-4)}`;
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

/* ── Sub-components ────────────────────────────────────────────── */

function ProofHashRow({ label, hash }: { label: string; hash?: string | null }) {
  if (!hash) return null;
  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded bg-zinc-800/50 text-xs">
      <span className="text-zinc-500 w-24 flex-shrink-0">{label}</span>
      <code className="flex-1 truncate text-zinc-300 font-mono text-[10px]">
        {hash}
      </code>
      <button
        type="button"
        onClick={() => copyToClipboard(hash)}
        className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
        title="Copy"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  );
}

function StatusBadge({ ok, yesLabel, noLabel }: { ok: boolean; yesLabel: string; noLabel: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${
        ok
          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
          : "bg-red-500/15 text-red-400 border border-red-500/30"
      }`}
    >
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {ok ? yesLabel : noLabel}
    </span>
  );
}

/* ── Single Proof Card (risk or anomaly) ───────────────────────── */

function ProofCard({
  title,
  icon: Icon,
  iconColor,
  state,
  proof,
  error,
  ok,
  okLabel,
  failLabel,
  scoreName,
  scoreValue,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  state: CardState;
  proof: ProofResult | null;
  error: string | null;
  ok: boolean;
  okLabel: string;
  failLabel: string;
  scoreName?: string;
  scoreValue?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasCalldata = proof?.proof_calldata && proof.proof_calldata.length > 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        <div
          className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-zinc-800 ${iconColor}`}
        >
          {state === "loading" ? (
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          ) : (
            <Icon className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {state === "idle" && (
            <p className="text-xs text-zinc-500">Ready to generate</p>
          )}
          {state === "loading" && (
            <p className="text-xs text-zinc-400">Generating Groth16 proof…</p>
          )}
          {state === "error" && (
            <p className="text-xs text-red-400 truncate">{error}</p>
          )}
          {state === "success" && (
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge ok={ok} yesLabel={okLabel} noLabel={failLabel} />
              {scoreName != null && scoreValue != null && (
                <span className="text-[10px] text-zinc-500">
                  {scoreName}: {scoreValue}
                </span>
              )}
            </div>
          )}
        </div>
        {state === "success" && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-zinc-500 hover:text-zinc-300"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && proof && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-1.5 border-t border-zinc-800 pt-3">
              <ProofHashRow label="Proof hash" hash={proof.proof_hash || proof.groth16_proof_hash} />
              <ProofHashRow label="Commitment" hash={proof.commitment_hash} />
              <ProofHashRow label="Snapshot" hash={proof.snapshot_hash} />
              {hasCalldata && (
                <div className="flex items-center gap-2 py-1 px-2 rounded bg-zinc-800/50 text-xs">
                  <span className="text-zinc-500 w-24 flex-shrink-0">Calldata</span>
                  <span className="text-emerald-400 font-mono text-[10px]">
                    {proof.proof_calldata!.length} felts
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    (Garaga BN254 Groth16)
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────── */

interface ZkmlResultCardsProps {
  address: string | undefined;
  poolId?: string;
}

export function ZkmlResultCards({ address, poolId = "ekubo_eth_usdc" }: ZkmlResultCardsProps) {
  const [riskState, setRiskState] = useState<CardState>("idle");
  const [anomalyState, setAnomalyState] = useState<CardState>("idle");
  const [combinedState, setCombinedState] = useState<CardState>("idle");

  const [riskProof, setRiskProof] = useState<ProofResult | null>(null);
  const [anomalyProof, setAnomalyProof] = useState<ProofResult | null>(null);
  const [combined, setCombined] = useState<CombinedResult | null>(null);

  const [riskError, setRiskError] = useState<string | null>(null);
  const [anomalyError, setAnomalyError] = useState<string | null>(null);
  const [combinedError, setCombinedError] = useState<string | null>(null);

  const defaultFeatures = [25, 80, 60, 90, 30, 70, 50, 40];

  const generateRisk = useCallback(async () => {
    if (!address) return;
    setRiskState("loading");
    setRiskError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/zkdefi/zkml/risk_score"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          portfolio_features: defaultFeatures,
          threshold: 30,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRiskProof(data);
      setRiskState("success");
    } catch (e: unknown) {
      setRiskError(e instanceof Error ? e.message : "Unknown error");
      setRiskState("error");
    }
  }, [address]);

  const generateAnomaly = useCallback(async () => {
    if (!address) return;
    setAnomalyState("loading");
    setAnomalyError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/zkdefi/zkml/anomaly"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          pool_id: poolId,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAnomalyProof(data);
      setAnomalyState("success");
    } catch (e: unknown) {
      setAnomalyError(e instanceof Error ? e.message : "Unknown error");
      setAnomalyState("error");
    }
  }, [address, poolId]);

  const generateCombined = useCallback(async () => {
    if (!address) return;
    setCombinedState("loading");
    setCombinedError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/zkdefi/zkml/combined"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          pool_id: poolId,
          portfolio_features: defaultFeatures,
          risk_threshold: 30,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CombinedResult = await res.json();
      setCombined(data);
      setRiskProof(data.risk_proof);
      setAnomalyProof(data.anomaly_proof);
      setRiskState("success");
      setAnomalyState("success");
      setCombinedState("success");
    } catch (e: unknown) {
      setCombinedError(e instanceof Error ? e.message : "Unknown error");
      setCombinedState("error");
    }
  }, [address, poolId]);

  const anyLoading = riskState === "loading" || anomalyState === "loading" || combinedState === "loading";

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-zinc-200">zkML Proofs</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={anyLoading || !address}
            onClick={generateCombined}
            className="text-[10px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {combinedState === "loading" ? "Proving…" : "Run Combined"}
          </button>
        </div>
      </div>

      {/* Proof cards */}
      <div className="grid grid-cols-1 gap-3">
        <ProofCard
          title="Risk Score"
          icon={riskProof?.is_compliant ? ShieldCheck : ShieldAlert}
          iconColor={
            riskState === "success"
              ? riskProof?.is_compliant
                ? "text-emerald-400"
                : "text-red-400"
              : "text-zinc-500"
          }
          state={riskState}
          proof={riskProof}
          error={riskError}
          ok={riskProof?.is_compliant ?? false}
          okLabel="Compliant"
          failLabel="Non-compliant"
          scoreName="risk"
          scoreValue={riskProof?.risk_score}
        />

        <ProofCard
          title="Anomaly Detection"
          icon={anomalyProof?.is_safe ? Activity : AlertTriangle}
          iconColor={
            anomalyState === "success"
              ? anomalyProof?.is_safe
                ? "text-emerald-400"
                : "text-amber-400"
              : "text-zinc-500"
          }
          state={anomalyState}
          proof={anomalyProof}
          error={anomalyError}
          ok={anomalyProof?.is_safe ?? false}
          okLabel="Pool Safe"
          failLabel="Anomaly Detected"
          scoreName="flag"
          scoreValue={anomalyProof?.anomaly_flag}
        />
      </div>

      {/* Combined result banner */}
      {combinedState === "success" && combined && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl border p-3 flex items-center gap-3 ${
            combined.can_proceed
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}
        >
          <Fingerprint
            className={`w-5 h-5 flex-shrink-0 ${
              combined.can_proceed ? "text-emerald-400" : "text-red-400"
            }`}
          />
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm font-semibold ${
                combined.can_proceed ? "text-emerald-300" : "text-red-300"
              }`}
            >
              {combined.can_proceed
                ? "Rebalancing Authorized"
                : "Rebalancing Blocked"}
            </p>
            <p className="text-[10px] text-zinc-400 mt-0.5">
              Risk: {combined.risk_compliant ? "✓" : "✗"} · Pool:{" "}
              {combined.pool_safe ? "✓" : "✗"} · Commitment:{" "}
              {truncHash(combined.commitment_hash)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] text-zinc-500">
              {(combined.combined_calldata?.risk_calldata?.length ?? 0) +
                (combined.combined_calldata?.anomaly_calldata?.length ?? 0)}{" "}
              calldata felts
            </span>
          </div>
        </motion.div>
      )}

      {combinedState === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          Combined proof failed: {combinedError}
        </div>
      )}

      {/* Individual run buttons (when not using combined) */}
      {combinedState === "idle" && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={riskState === "loading" || !address}
            onClick={generateRisk}
            className="flex-1 text-[10px] px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {riskState === "loading" ? "Proving…" : "Risk Only"}
          </button>
          <button
            type="button"
            disabled={anomalyState === "loading" || !address}
            onClick={generateAnomaly}
            className="flex-1 text-[10px] px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {anomalyState === "loading" ? "Proving…" : "Anomaly Only"}
          </button>
        </div>
      )}
    </div>
  );
}

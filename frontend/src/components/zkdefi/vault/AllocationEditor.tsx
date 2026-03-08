"use client";

/**
 * AllocationEditor — Interactive post-deposit capital deployment panel.
 *
 * Replaces the static AllocationPreview with:
 *  • AI-recommended allocation from /strategies/recommend
 *  • Draggable sliders per strategy (auto-normalize to 100%)
 *  • ZK circuit screening (YieldOptimality + StrategyIntegrity)
 *  • LLM-generated verbose reasoning
 *  • "Deploy Capital" button → /orchestration/deploy
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  RotateCcw,
  Rocket,
  Brain,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";
import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StrategySlice {
  key: string;
  label: string;
  color: string;        // tailwind bg class
  barColor: string;     // hex for the slider track
  pct: number;          // 0-100
  apy: number;          // e.g. 27.5
  isAiSet: boolean;     // true = matches AI recommendation
}

interface ZKScreenResult {
  status: "idle" | "running" | "passed" | "flagged" | "error";
  yieldValid?: boolean;
  integrityValid?: boolean;
  proofHashes?: Record<string, string | null>;
  error?: string;
}

export interface AllocationEditorProps {
  amount: string;
  asset: "STRK" | "ETH" | "strkBTC";
  riskProfile?: string;
  address?: string;
  isDemo?: boolean;
  /** Called after a successful deploy so the parent can refresh positions */
  onDeployed?: (result: {
    deploymentId: string;
    receiptId: string;
    positions: { strategy: string; amount: number; status: string }[];
  }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SLICES: StrategySlice[] = [
  { key: "ekubo_lp", label: "Ekubo LP", color: "bg-blue-500", barColor: "#3b82f6", pct: 60, apy: 27.1, isAiSet: true },
  { key: "lending",  label: "Lending",  color: "bg-green-500", barColor: "#22c55e", pct: 25, apy: 8.2,  isAiSet: true },
  { key: "staking",  label: "Staking",  color: "bg-orange-500", barColor: "#f97316", pct: 10, apy: 5.4,  isAiSet: true },
  { key: "idle",     label: "Idle",     color: "bg-zinc-500", barColor: "#71717a", pct: 5,  apy: 0,    isAiSet: true },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blendedApy(slices: StrategySlice[]): number {
  return slices.reduce((sum, s) => sum + (s.pct / 100) * s.apy, 0);
}

/** Redistribute delta proportionally among other slices after one was dragged */
function redistribute(slices: StrategySlice[], changedIdx: number, newPct: number): StrategySlice[] {
  const clamped = Math.max(0, Math.min(100, Math.round(newPct)));
  const oldPct = slices[changedIdx].pct;
  const delta = clamped - oldPct;
  if (delta === 0) return slices;

  const others = slices.filter((_, i) => i !== changedIdx);
  const othersSum = others.reduce((s, o) => s + o.pct, 0);

  const next = slices.map((s, i) => {
    if (i === changedIdx) return { ...s, pct: clamped, isAiSet: false };
    if (othersSum === 0) return { ...s, pct: Math.round((100 - clamped) / (slices.length - 1)), isAiSet: false };
    const share = s.pct / othersSum;
    return { ...s, pct: Math.max(0, Math.round(s.pct - delta * share)), isAiSet: false };
  });

  // Fix rounding so total = 100
  const total = next.reduce((s, x) => s + x.pct, 0);
  if (total !== 100 && next.length > 1) {
    const fixIdx = next.findIndex((_, i) => i !== changedIdx);
    if (fixIdx >= 0) next[fixIdx] = { ...next[fixIdx], pct: next[fixIdx].pct + (100 - total) };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AllocationEditor({
  amount,
  asset,
  riskProfile = "balanced",
  address,
  isDemo,
  onDeployed,
}: AllocationEditorProps) {
  const [slices, setSlices] = useState<StrategySlice[]>(DEFAULT_SLICES);
  const [aiSlices, setAiSlices] = useState<StrategySlice[]>(DEFAULT_SLICES);
  const [loading, setLoading] = useState(false);
  const [reasoning, setReasoning] = useState<string>("");
  const [confidence, setConfidence] = useState<number>(0.85);
  const [showReasoning, setShowReasoning] = useState(false);
  const [zkScreen, setZkScreen] = useState<ZKScreenResult>({ status: "idle" });
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const fetchedRef = useRef<string>("");

  const amountNum = parseFloat(amount);
  const showEditor = amountNum > 0;
  const isUserOverridden = slices.some((s) => !s.isAiSet);

  // -----------------------------------------------------------------------
  // Fetch AI recommendation
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!showEditor || isDemo) return;
    const key = `${address}_${amount}_${riskProfile}_${asset}`;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    let dead = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/strategies/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: address || "0x0",
            amount: amountNum,
            risk_profile: riskProfile,
            asset,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok || dead) return;
        const data = await res.json();

        // Map pools to slices
        const pools = data.recommended_pools || [];
        const newSlices: StrategySlice[] = [];

        // Ekubo LP pools aggregated
        const ekuboPools = pools.filter((p: Record<string, unknown>) => String(p.protocol || "").toLowerCase() === "ekubo");
        const ekuboPct = ekuboPools.reduce((s: number, p: Record<string, unknown>) => s + Number(p.allocation_percent || 0), 0);
        const ekuboApy = ekuboPools.length > 0
          ? ekuboPools.reduce((s: number, p: Record<string, unknown>) => s + Number(p.expected_apy || 0) * Number(p.allocation_percent || 0), 0) / (ekuboPct || 1)
          : 0;

        newSlices.push({
          key: "ekubo_lp",
          label: "Ekubo LP",
          color: "bg-blue-500",
          barColor: "#3b82f6",
          pct: Math.round(ekuboPct),
          apy: Number((ekuboApy * 100).toFixed(1)),
          isAiSet: true,
        });

        // Fill remaining buckets (lending, staking, idle) as remainder
        const remaining = Math.max(0, 100 - Math.round(ekuboPct));
        newSlices.push({ key: "lending", label: "Lending", color: "bg-green-500", barColor: "#22c55e", pct: Math.round(remaining * 0.55), apy: 8.2, isAiSet: true });
        newSlices.push({ key: "staking", label: "Staking", color: "bg-orange-500", barColor: "#f97316", pct: Math.round(remaining * 0.30), apy: 5.4, isAiSet: true });
        // Idle gets the rounding remainder
        const usedPct = newSlices.reduce((s, sl) => s + sl.pct, 0);
        newSlices.push({ key: "idle", label: "Idle", color: "bg-zinc-500", barColor: "#71717a", pct: 100 - usedPct, apy: 0, isAiSet: true });

        if (!dead) {
          setSlices(newSlices);
          setAiSlices(newSlices);
          setReasoning(data.ai_reasoning || "");
          setConfidence(data.ai_confidence ?? 0.85);
        }
      } catch {
        // keep defaults
      } finally {
        if (!dead) setLoading(false);
      }
    })();

    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEditor, address, amount, riskProfile, asset, isDemo]);

  // -----------------------------------------------------------------------
  // ZK screening
  // -----------------------------------------------------------------------
  const runZkScreen = useCallback(async () => {
    setZkScreen({ status: "running" });
    try {
      const avgApy = blendedApy(slices);
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/skills/screen/opportunity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_id: "portfolio_allocation",
          apy_bps: Math.round(avgApy * 100),
          risk_level: riskProfile === "aggressive" ? "high" : riskProfile === "conservative" ? "low" : "medium",
          user_address: address || "0x0",
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error("Screening failed");
      const data = await res.json();
      setZkScreen({
        status: data.is_proved ? "passed" : "flagged",
        yieldValid: data.yield_result?.is_compliant ?? data.yield_result?.success,
        integrityValid: data.integrity_result?.is_compliant ?? data.integrity_result?.success,
        proofHashes: data.proof_hashes,
      });
    } catch (err) {
      setZkScreen({ status: "error", error: err instanceof Error ? err.message : "Unknown error" });
    }
  }, [slices, riskProfile, address]);

  // Auto-screen when slices change
  useEffect(() => {
    if (!showEditor || isDemo || loading) return;
    const t = setTimeout(() => runZkScreen(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slices, showEditor, isDemo, loading]);

  // -----------------------------------------------------------------------
  // Deploy
  // -----------------------------------------------------------------------
  const handleDeploy = useCallback(async () => {
    if (!address || amountNum <= 0) return;
    setDeploying(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/orchestration/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          deployable_amount: amountNum,
          risk_profile: riskProfile,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error("Deploy failed");
      const data = await res.json();
      setDeployed(true);
      onDeployed?.({
        deploymentId: data.deployment_id,
        receiptId: data.receipt_id,
        positions: data.positions || [],
      });
    } catch {
      // allow retry
    } finally {
      setDeploying(false);
    }
  }, [address, amountNum, riskProfile, onDeployed]);

  // -----------------------------------------------------------------------
  // Reset to AI
  // -----------------------------------------------------------------------
  const resetToAi = useCallback(() => {
    setSlices(aiSlices);
    setDeployed(false);
  }, [aiSlices]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!showEditor) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
        <p className="text-sm text-zinc-500">Enter an amount to see AI-recommended deployment</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span className="text-sm text-zinc-400">AI analyzing optimal allocation...</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-3 bg-zinc-800 rounded animate-pulse" style={{ width: `${100 - i * 15}%` }} />
          ))}
        </div>
      </div>
    );
  }

  const blend = blendedApy(slices);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-zinc-700/60 bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 p-4 space-y-3"
    >
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h4 className="text-sm font-semibold text-zinc-100">Capital Deployment</h4>
          {!isUserOverridden && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20">
              <Brain className="w-3 h-3" /> AI Recommended
            </span>
          )}
          {isUserOverridden && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-400 border border-violet-500/20">
              Custom
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isUserOverridden && (
            <button onClick={resetToAi} className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 transition-colors">
              <RotateCcw className="w-3 h-3" /> Reset to AI
            </button>
          )}
          <span className="text-sm font-medium text-emerald-400">{blend.toFixed(1)}% APY</span>
        </div>
      </div>

      {/* ── Sliders ───────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {slices.map((slice, idx) => (
          <div key={slice.key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-full ${slice.color}`} />
                {slice.label}
                {slice.apy > 0 && <span className="text-zinc-600 ml-1">{slice.apy.toFixed(1)}%</span>}
              </span>
              <span className={`font-mono font-medium ${slice.isAiSet ? "text-zinc-300" : "text-violet-300"}`}>
                {slice.pct}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={slice.pct}
              onChange={(e) => setSlices((prev) => redistribute(prev, idx, Number(e.target.value)))}
              className="alloc-slider w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, ${slice.barColor} 0%, ${slice.barColor} ${slice.pct}%, rgba(63,63,70,0.5) ${slice.pct}%, rgba(63,63,70,0.5) 100%)`,
                // @ts-expect-error CSS custom property for thumb color
                "--thumb-bg": slice.barColor,
              }}
            />
          </div>
        ))}
      </div>

      {/* ── Stacked bar ───────────────────────────────────────── */}
      <div className="h-2 flex rounded-full overflow-hidden bg-zinc-800">
        {slices.map((s) =>
          s.pct > 0 ? (
            <div key={s.key} className={s.color} style={{ width: `${s.pct}%` }} title={`${s.label}: ${s.pct}%`} />
          ) : null,
        )}
      </div>

      {/* ── ZK Circuit Screening ──────────────────────────────── */}
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400 flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-yellow-500" />
            ZK Circuit Screening
          </span>
          {zkScreen.status === "running" && <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />}
          {zkScreen.status === "passed" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
          {zkScreen.status === "flagged" && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
          {zkScreen.status === "error" && <XCircle className="w-3.5 h-3.5 text-red-400" />}
        </div>

        {zkScreen.status !== "idle" && (
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center gap-1">
              {zkScreen.yieldValid === true && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
              {zkScreen.yieldValid === false && <XCircle className="w-3 h-3 text-red-400" />}
              {zkScreen.yieldValid === undefined && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
              <span className="text-zinc-500">YieldOptimality</span>
            </div>
            <div className="flex items-center gap-1">
              {zkScreen.integrityValid === true && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
              {zkScreen.integrityValid === false && <XCircle className="w-3 h-3 text-red-400" />}
              {zkScreen.integrityValid === undefined && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
              <span className="text-zinc-500">StrategyIntegrity</span>
            </div>
          </div>
        )}

        {zkScreen.status === "passed" && (
          <p className="text-[10px] text-emerald-500/70">
            Allocation verified by Groth16 circuits — yield within optimality threshold, strategy constraints met.
          </p>
        )}
        {zkScreen.status === "flagged" && (
          <p className="text-[10px] text-amber-500/70">
            Circuit flagged allocation — consider adjusting sliders or resetting to AI recommendation.
          </p>
        )}
      </div>

      {/* ── LLM Reasoning ─────────────────────────────────────── */}
      {reasoning && (
        <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/20 overflow-hidden">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Brain className="w-3 h-3 text-amber-400" />
              AI Reasoning
              <span className="text-zinc-600">— {Math.round(confidence * 100)}% confidence</span>
            </span>
            {showReasoning ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <AnimatePresence>
            {showReasoning && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <p className="px-3 pb-3 text-xs text-zinc-400 leading-relaxed">
                  {reasoning}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Deploy Button ─────────────────────────────────────── */}
      {!deployed ? (
        <button
          disabled={deploying || !address || zkScreen.status === "running"}
          onClick={handleDeploy}
          className={`w-full rounded-lg py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            deploying || !address || zkScreen.status === "running"
              ? "bg-white/[0.06] text-white/30 cursor-not-allowed"
              : zkScreen.status === "flagged"
                ? "bg-gradient-to-r from-amber-600 to-amber-700 text-white hover:from-amber-500 hover:to-amber-600 shadow-lg shadow-amber-900/20"
                : "bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-900/30"
          }`}
        >
          {deploying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Deploying Capital...
            </>
          ) : (
            <>
              <Rocket className="w-4 h-4" />
              Deploy Capital{zkScreen.status === "flagged" ? " (Override)" : ""}
            </>
          )}
        </button>
      ) : (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-900/30 border border-emerald-700/30 py-2.5 text-sm text-emerald-400">
          <ShieldCheck className="w-4 h-4" />
          Capital Deployed Successfully
        </div>
      )}
    </motion.div>
  );
}

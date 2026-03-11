"use client";

import { useCallback, useEffect, useRef } from "react";
import { X, Info, ArrowRight, TrendingUp, Shield, BarChart3 } from "lucide-react";

/* ═══════════════════ types ═══════════════════ */

export interface RiskBreakdown {
  total: number;
  formula: string;
  interpretation: string;
  thresholds: { safe: string; moderate: string; risky: string };
}

export interface SafetyExplanation {
  level: string;
  formula: string;
  applied: string;
  meaning: string;
}

export interface AllocationExplanation {
  range: string;
  midpoint: number;
  formula: string;
  applied: string;
  meaning: string;
}

export interface APYPath {
  raw_apy: string;
  risk_penalty: string;
  confidence: string;
  risk_adjusted_apy: string;
  formula: string;
  path: string[];
}

export interface PoolExplanation {
  pool_id: string;
  pool_name: string;
  risk_breakdown: RiskBreakdown;
  safety_explanation: SafetyExplanation;
  allocation_explanation: AllocationExplanation;
  apy_path: APYPath;
}

export type ExplainerType = "safety" | "risk" | "allocation" | "apy";

/* ═══════════════════ color maps ═══════════════════ */

const TYPE_META: Record<
  ExplainerType,
  { title: string; icon: typeof Shield; color: string; bg: string; border: string }
> = {
  safety: {
    title: "Safety Level",
    icon: Shield,
    color: "text-emerald-400",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
  },
  risk: {
    title: "Risk Score",
    icon: BarChart3,
    color: "text-amber-400",
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
  },
  allocation: {
    title: "Allocation %",
    icon: TrendingUp,
    color: "text-cyan-400",
    bg: "bg-cyan-500/5",
    border: "border-cyan-500/20",
  },
  apy: {
    title: "Projected APY Path",
    icon: TrendingUp,
    color: "text-violet-400",
    bg: "bg-violet-500/5",
    border: "border-violet-500/20",
  },
};

/* ═══════════════════ component ═══════════════════ */

interface ExplainerModalProps {
  type: ExplainerType;
  explanation: PoolExplanation | null;
  poolName: string;
  onClose: () => void;
}

export function ExplainerModal({ type, explanation, poolName, onClose }: ExplainerModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!explanation) return null;

  const meta = TYPE_META[type];
  const Icon = meta.icon;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        className={`relative w-full max-w-md rounded-2xl border ${meta.border} ${meta.bg} bg-zinc-900/95 p-5 shadow-2xl`}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${meta.color}`} />
            <h3 className={`text-sm font-semibold ${meta.color}`}>{meta.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Pool name */}
        <div className="mb-4 text-xs text-zinc-500">
          Pool: <span className="font-medium text-zinc-300">{poolName}</span>
        </div>

        {/* Content by type */}
        {type === "safety" && <SafetyContent explanation={explanation} />}
        {type === "risk" && <RiskContent explanation={explanation} />}
        {type === "allocation" && <AllocationContent explanation={explanation} />}
        {type === "apy" && <APYContent explanation={explanation} />}

        {/* Footer */}
        <div className="mt-4 flex items-center gap-2 border-t border-zinc-800/50 pt-3 text-[10px] text-zinc-600">
          <Info className="h-3 w-3" />
          <span>All scores are deterministic and verifiable via SHA-256 proof hash</span>
        </div>
      </div>
    </div>
  );
}

/* ── Safety explanation ── */

function SafetyContent({ explanation }: { explanation: PoolExplanation }) {
  const s = explanation.safety_explanation;
  const LEVELS = [
    { level: "safe", range: "<30", color: "bg-emerald-500", text: "text-emerald-400" },
    { level: "moderate", range: "30-59", color: "bg-amber-500", text: "text-amber-400" },
    { level: "risky", range: "≥60", color: "bg-rose-500", text: "text-rose-400" },
  ];

  return (
    <div className="space-y-3">
      {/* Formula */}
      <FormulaBlock formula={s.formula} />

      {/* Thresholds visual */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Thresholds
        </span>
        {LEVELS.map((l) => (
          <div
            key={l.level}
            className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-[11px] ${
              s.level === l.level ? "bg-zinc-800/60 ring-1 ring-zinc-700" : ""
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${l.color}`} />
            <span className={`w-16 font-medium ${l.text}`}>{l.level}</span>
            <span className="text-zinc-500">risk {l.range}</span>
            {s.level === l.level && (
              <ArrowRight className={`ml-auto h-3 w-3 ${l.text}`} />
            )}
          </div>
        ))}
      </div>

      {/* Applied */}
      <div className="rounded-lg bg-zinc-800/40 p-3 text-[11px]">
        <div className="mb-1 text-zinc-500">Applied to this pool:</div>
        <div className="font-mono text-zinc-300">{s.applied}</div>
      </div>

      {/* Meaning */}
      <div className="text-xs text-zinc-400">{s.meaning}</div>
    </div>
  );
}

/* ── Risk explanation ── */

function RiskContent({ explanation }: { explanation: PoolExplanation }) {
  const r = explanation.risk_breakdown;
  const FACTORS = [
    { label: "Liquidity", range: "0-30", desc: "TVL depth — more liquidity = safer" },
    { label: "Volatility", range: "0-25", desc: "Price std dev — lower = safer" },
    { label: "Volume/Liq", range: "0-20", desc: "Trading volume ratio — higher = safer" },
    { label: "Slippage", range: "0-15", desc: "Price impact at $1k — lower = safer" },
    { label: "Fee Tier", range: "0-10", desc: "Fee appropriateness for pair" },
  ];

  return (
    <div className="space-y-3">
      {/* Formula */}
      <FormulaBlock formula={r.formula} />

      {/* Factor table */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Risk Factors
        </span>
        {FACTORS.map((f) => (
          <div key={f.label} className="flex items-center gap-3 text-[11px]">
            <span className="w-20 text-zinc-400">{f.label}</span>
            <span className="w-10 font-mono text-zinc-500">{f.range}</span>
            <span className="flex-1 text-zinc-600">{f.desc}</span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="rounded-lg bg-zinc-800/40 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Total Risk Score</span>
          <span className="text-lg font-bold text-amber-400">{r.total}/100</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-700">
          <div
            className={`h-full rounded-full transition-all ${
              r.total < 30 ? "bg-emerald-500" : r.total < 60 ? "bg-amber-500" : "bg-rose-500"
            }`}
            style={{ width: `${r.total}%` }}
          />
        </div>
      </div>

      {/* Interpretation */}
      <div className="text-xs text-zinc-400">{r.interpretation}</div>
    </div>
  );
}

/* ── Allocation explanation ── */

function AllocationContent({ explanation }: { explanation: PoolExplanation }) {
  const a = explanation.allocation_explanation;

  return (
    <div className="space-y-3">
      {/* Formula */}
      <FormulaBlock formula={a.formula} />

      {/* Applied */}
      <div className="rounded-lg bg-zinc-800/40 p-3 text-[11px]">
        <div className="mb-1 text-zinc-500">Applied to this pool:</div>
        <div className="font-mono text-zinc-300">{a.applied}</div>
      </div>

      {/* Visual range */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Allocation Range</span>
          <span className="font-mono text-cyan-400">{a.range}</span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="absolute h-full bg-cyan-500/30 rounded-full"
            style={{
              left: `${parseFloat(a.range.split("–")[0])}%`,
              width: `${parseFloat(a.range.split("–")[1] || "0") - parseFloat(a.range.split("–")[0])}%`,
            }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-cyan-400"
            style={{ left: `${a.midpoint}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-600">0%</span>
          <span className="font-medium text-cyan-400">Display: {a.midpoint}%</span>
          <span className="text-zinc-600">100%</span>
        </div>
      </div>

      {/* Meaning */}
      <div className="text-xs text-zinc-400">{a.meaning}</div>
    </div>
  );
}

/* ── APY path explanation ── */

function APYContent({ explanation }: { explanation: PoolExplanation }) {
  const a = explanation.apy_path;

  return (
    <div className="space-y-3">
      {/* Formula */}
      <FormulaBlock formula={a.formula} />

      {/* Step-by-step path */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Calculation Path
        </span>
        {a.path.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[9px] font-bold text-violet-400">
              {i + 1}
            </span>
            <span className="font-mono text-zinc-300">{step.replace(/^\d+\.\s*/, "")}</span>
          </div>
        ))}
      </div>

      {/* Result */}
      <div className="rounded-lg bg-zinc-800/40 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Risk-Adjusted APY</span>
          <span className="text-lg font-bold text-violet-400">{a.risk_adjusted_apy}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-600">
          <span>Raw: {a.raw_apy}</span>
          <span>Penalty: {a.risk_penalty}</span>
          <span>Confidence: {a.confidence}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Formula display ── */

function FormulaBlock({ formula }: { formula: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/60 p-3">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
        Formula
      </div>
      <code className="text-[11px] leading-relaxed text-zinc-300">{formula}</code>
    </div>
  );
}

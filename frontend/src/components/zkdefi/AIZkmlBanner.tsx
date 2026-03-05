"use client";

import { useState, useEffect } from "react";
import { Brain, Cpu, Shield, Sparkles, TrendingUp, Zap, FileCheck, ChevronDown, ChevronUp } from "lucide-react";
import { API_BASE } from "@/lib/api/client";

interface AIZkmlBannerProps {
  address: string | undefined;
  onNavigateToBrain?: () => void;
}

interface PredictiveCredit {
  grade: string;
  grade_confidence: number;
  max_ltv: number;
  rate_bps: number;
  credit_line_eth: number;
  collaborative_multiplier: number;
  model_name: string;
  proof_hash: string | null;
}

interface ZkmlScanStatus {
  circuits_available: number;
  last_scan_at: string | null;
  risk_score_status: string;
  anomaly_status: string;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePredictiveCredit(input: unknown): PredictiveCredit | null {
  if (!input || typeof input !== "object") return null;
  const row = toRecord(input);
  const terms = toRecord(row.terms);
  const grade = String(row.grade ?? row.credit_class ?? "N/A");
  return {
    grade,
    grade_confidence: toNumber(row.grade_confidence, 0),
    max_ltv: toNumber(row.max_ltv ?? terms.ltv, 0),
    rate_bps: toNumber(row.rate_bps ?? terms.rate_bps, 0),
    credit_line_eth: toNumber(row.credit_line_eth, 0),
    collaborative_multiplier: toNumber(row.collaborative_multiplier, 1),
    model_name: String(row.model_name ?? row.model_hash ?? "predictor"),
    proof_hash: typeof row.proof_hash === "string" ? row.proof_hash : null,
  };
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-cyan-400";
  if (grade.startsWith("C")) return "text-amber-400";
  if (grade.startsWith("D")) return "text-orange-400";
  return "text-zinc-400";
}

function gradeBg(grade: string): string {
  if (grade.startsWith("A")) return "bg-emerald-500/15 border-emerald-500/30";
  if (grade.startsWith("B")) return "bg-cyan-500/15 border-cyan-500/30";
  if (grade.startsWith("C")) return "bg-amber-500/15 border-amber-500/30";
  return "bg-zinc-500/15 border-zinc-500/30";
}

export function AIZkmlBanner({ address, onNavigateToBrain }: AIZkmlBannerProps) {
  const [credit, setCredit] = useState<PredictiveCredit | null>(null);
  const [zkmlStatus, setZkmlStatus] = useState<ZkmlScanStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) { setLoading(false); return; }
    let dead = false;

    (async () => {
      setLoading(true);
      try {
        // Fetch v2 profile for predictive credit
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_profile/v2/${address}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok && !dead) {
          const data = await res.json();
          setCredit(normalizePredictiveCredit(data?.predictive_credit));
        }
      } catch { /* best effort */ }

      // Fetch zkML circuit status
      try {
        const scanRes = await fetch(`${API_BASE}/api/v1/zkdefi/zkml/status`, {
          signal: AbortSignal.timeout(5000),
        });
        if (scanRes.ok && !dead) {
          const data = await scanRes.json();
          setZkmlStatus(data);
        }
      } catch { /* best effort */ }

      if (!dead) setLoading(false);
    })();

    return () => { dead = true; };
  }, [address]);

  if (!address) return null;

  return (
    <div className="rounded-xl border border-violet-700/30 bg-gradient-to-r from-violet-950/40 via-indigo-950/30 to-zinc-900/40 overflow-hidden">
      {/* Compact banner header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-violet-900/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600/30 to-indigo-600/30 border border-violet-500/30 flex items-center justify-center">
              <Brain className="w-5 h-5 text-violet-400" />
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border border-zinc-900 animate-pulse" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">AI + zkML Engine</h3>
              <span className="text-[9px] font-mono text-violet-300 bg-violet-500/20 px-1.5 py-0.5 rounded">v6</span>
              <span className="text-[9px] font-mono text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded">LIVE</span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {loading ? "Loading AI models…" : (
                credit
                  ? `Credit grade ${credit.grade} · ${credit.model_name} · Confidence ${(credit.grade_confidence * 100).toFixed(0)}%`
                  : "Predictive credit scoring · zkML proof verification · LLM decision engine"
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Quick stats */}
          {credit && !loading && (
            <div className="hidden sm:flex items-center gap-2">
              <div className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${gradeBg(credit.grade)} ${gradeColor(credit.grade)}`}>
                {credit.grade}
              </div>
              <div className="text-[10px] text-zinc-500">
                LTV {(credit.max_ltv * 100).toFixed(0)}%
              </div>
            </div>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </div>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-violet-800/20 pt-4 space-y-4">
          {/* 4-column feature grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Predictive Credit */}
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="w-3.5 h-3.5 text-violet-400" />
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">AI Credit</p>
              </div>
              {credit ? (
                <>
                  <p className={`text-2xl font-bold ${gradeColor(credit.grade)}`}>{credit.grade}</p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-zinc-700/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${(credit.grade_confidence * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">{(credit.grade_confidence * 100).toFixed(0)}% confidence</p>
                </>
              ) : (
                <p className="text-xs text-zinc-500">No history yet</p>
              )}
            </div>

            {/* zkML Circuits */}
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">zkML Circuits</p>
              </div>
              <p className="text-2xl font-bold text-cyan-400">3</p>
              <div className="flex items-center gap-1 mt-1">
                {["RiskScore", "Anomaly", "Slippage"].map((c) => (
                  <span key={c} className="text-[9px] bg-cyan-500/10 text-cyan-300 px-1 py-0.5 rounded">{c}</span>
                ))}
              </div>
            </div>

            {/* LLM Engine */}
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">LLM Engine</p>
              </div>
              <p className="text-2xl font-bold text-amber-400">Active</p>
              <p className="text-[10px] text-zinc-500 mt-1">Strategy decisions + safety net</p>
            </div>

            {/* Proof Pipeline */}
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Proof Pipeline</p>
              </div>
              <p className="text-2xl font-bold text-emerald-400">5-step</p>
              <p className="text-[10px] text-zinc-500 mt-1">Decision → zkML → Proof → Verify → Execute</p>
            </div>
          </div>

          {/* Tech stack line */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-300 border-violet-500/20">XGBoost Predictor</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/20">EZKL Prover</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-300 border-emerald-500/20">Groth16 BN254</span>
              {credit?.proof_hash && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-green-500/10 text-green-300 border-green-500/20" title={credit.proof_hash}>
                  Proof {credit.proof_hash.slice(0, 10)}…
                </span>
              )}
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/20">Garaga Verifier</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-pink-500/10 text-pink-300 border-pink-500/20">Credit Graph</span>
            </div>
            <button
              type="button"
              onClick={onNavigateToBrain}
              className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors"
            >
              Open Brain <Zap className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

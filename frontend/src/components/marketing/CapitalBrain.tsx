"use client";

import { useState, useCallback } from "react";
import { Brain, Cpu, Loader2, Zap, Play } from "lucide-react";

/* ═══════════════════ skill definitions ═══════════════════ */

export interface SkillDef {
  id: string;
  label: string;
  short: string;
  category: "agent" | "ml" | "reputation";
  defaultOn: boolean;
}

export const DEMO_SKILLS: SkillDef[] = [
  { id: "il_predictor", label: "IL Predictor", short: "IL", category: "agent", defaultOn: true },
  { id: "yield_optimality", label: "Yield Check", short: "Yield", category: "agent", defaultOn: true },
  { id: "slippage_bound", label: "Slippage Guard", short: "Slip", category: "agent", defaultOn: true },
  { id: "strategy_integrity", label: "Strategy Compliance", short: "Strat", category: "agent", defaultOn: true },
  { id: "execution_integrity", label: "Execution Quality", short: "Exec", category: "agent", defaultOn: true },
  { id: "risk_score", label: "Risk Score", short: "Risk", category: "ml", defaultOn: false },
  { id: "anomaly_detection", label: "Anomaly Detect", short: "Anom", category: "ml", defaultOn: false },
  { id: "solvency_proof", label: "Solvency Proof", short: "Solv", category: "reputation", defaultOn: false },
];

export const DEFAULT_ENABLED = DEMO_SKILLS.filter((s) => s.defaultOn).map((s) => s.id);

/* ═══════════════════ types ═══════════════════ */

export type VenuePref = "best" | "ekubo" | "avnu";

export interface BrainConfig {
  riskTolerance: number;
  enabledSkills: string[];
  protocolWeights: { ekubo: number; vesu: number; lending: number };
  venuePref: VenuePref;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  agent: { label: "Agent Skills", color: "text-cyan-500" },
  ml: { label: "ML Scoring", color: "text-violet-500" },
  reputation: { label: "Reputation", color: "text-amber-500" },
};

const PROTOCOL_SLIDERS = [
  { key: "ekubo" as const, label: "Ekubo", color: "accent-cyan-500" },
  { key: "vesu" as const, label: "Vesu", color: "accent-emerald-500" },
  { key: "lending" as const, label: "Lending", color: "accent-blue-500" },
];

/* ═══════════════════ component ═══════════════════ */

interface CapitalBrainProps {
  onAnalyze: (config: BrainConfig) => void;
  loading: boolean;
}

const VENUE_OPTIONS: { key: VenuePref; label: string; desc: string }[] = [
  { key: "best", label: "Best", desc: "Auto-route via AVNU + Ekubo" },
  { key: "ekubo", label: "Ekubo", desc: "Direct Ekubo pools" },
  { key: "avnu", label: "AVNU", desc: "AVNU aggregator" },
];

export function CapitalBrain({ onAnalyze, loading }: CapitalBrainProps) {
  const [risk, setRisk] = useState(50);
  const [skills, setSkills] = useState<Set<string>>(new Set(DEFAULT_ENABLED));
  const [weights, setWeights] = useState({ ekubo: 50, vesu: 30, lending: 20 });
  const [venue, setVenue] = useState<VenuePref>("best");

  const toggleSkill = useCallback((id: string) => {
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const updateWeight = useCallback((key: "ekubo" | "vesu" | "lending", val: number) => {
    setWeights((prev) => {
      const others = Object.entries(prev).filter(([k]) => k !== key);
      const othersSum = others.reduce((s, [, v]) => s + v, 0);
      // clamp so total doesn't exceed 100
      const clamped = Math.min(val, 100 - Math.max(0, 100 - othersSum - prev[key]) + (100 - othersSum));
      return { ...prev, [key]: Math.min(val, 100 - (100 - othersSum - prev[key]) + (100 - othersSum)) > 100 ? Math.min(val, 100) : val };
    });
  }, []);

  const handleAnalyze = () => {
    onAnalyze({
      riskTolerance: risk,
      enabledSkills: Array.from(skills),
      protocolWeights: weights,
      venuePref: venue,
    });
  };

  const riskLabel = risk <= 33 ? "Conservative" : risk <= 66 ? "Balanced" : "Aggressive";
  const riskColor = risk <= 33 ? "text-emerald-400" : risk <= 66 ? "text-cyan-400" : "text-amber-400";
  const riskAccent = risk <= 33 ? "accent-emerald-500" : risk <= 66 ? "accent-cyan-500" : "accent-amber-500";

  /* group skills by category */
  const grouped = DEMO_SKILLS.reduce<Record<string, SkillDef[]>>((acc, sk) => {
    (acc[sk.category] ??= []).push(sk);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-violet-400" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          AI Brain
        </h3>
      </div>

      {/* Risk tolerance */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Risk Tolerance</span>
          <span className={`font-medium tabular-nums ${riskColor}`}>
            {risk}% · {riskLabel}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={risk}
          onChange={(e) => setRisk(Number(e.target.value))}
          className={`w-full h-1.5 rounded-full appearance-none bg-zinc-800 cursor-pointer ${riskAccent}`}
        />
        <div className="flex justify-between text-[9px] text-zinc-700">
          <span>Conservative</span>
          <span>Aggressive</span>
        </div>
      </div>

      {/* Protocol weights */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Protocol Preference
        </span>
        {PROTOCOL_SLIDERS.map(({ key, label, color }) => (
          <div key={key} className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-500">{label}</span>
              <span className="font-mono text-zinc-400">{weights[key]}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={weights[key]}
              onChange={(e) => updateWeight(key, Number(e.target.value))}
              className={`w-full h-1 rounded-full appearance-none bg-zinc-800 cursor-pointer ${color}`}
            />
          </div>
        ))}
      </div>

      {/* Circuit skill toggles */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-zinc-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Circuit Skills
          </span>
          <span className="ml-auto text-[9px] text-zinc-600">
            {skills.size}/{DEMO_SKILLS.length}
          </span>
        </div>
        {Object.entries(grouped).map(([cat, items]) => {
          const catMeta = CATEGORY_LABELS[cat] ?? CATEGORY_LABELS.agent;
          return (
            <div key={cat} className="space-y-1">
              <span className={`text-[9px] font-medium uppercase tracking-wider ${catMeta.color}`}>
                {catMeta.label}
              </span>
              <div className="flex flex-wrap gap-1">
                {items.map((sk) => {
                  const on = skills.has(sk.id);
                  return (
                    <button
                      key={sk.id}
                      onClick={() => toggleSkill(sk.id)}
                      title={sk.label}
                      className={`rounded-full border px-2 py-0.5 text-[9px] font-medium transition-all ${
                        on
                          ? "border-violet-500/30 bg-violet-500/15 text-violet-300"
                          : "border-zinc-800 bg-zinc-900/30 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      {on && <Zap className="inline h-2 w-2 mr-0.5" />}
                      {sk.short}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Venue routing */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Swap Routing
        </span>
        <div className="flex gap-1">
          {VENUE_OPTIONS.map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => setVenue(key)}
              title={desc}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[10px] font-medium transition-all ${
                venue === key
                  ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-300"
                  : "border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-zinc-700">
          {venue === "best" ? "Compares Ekubo & AVNU, picks best rate" : venue === "ekubo" ? "Direct Ekubo concentrated liquidity" : "AVNU multi-hop aggregator"}
        </p>
      </div>

      {/* Analyze button */}
      <button
        onClick={handleAnalyze}
        disabled={loading || skills.size === 0}
        className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:from-violet-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Analyzing…
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" />
            Run Analysis
          </>
        )}
      </button>

      <p className="text-[9px] text-zinc-700 leading-relaxed">
        No wallet required · Obsqra infra
      </p>
    </div>
  );
}

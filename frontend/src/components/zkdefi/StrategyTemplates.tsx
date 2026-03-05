"use client";

import React from "react";
import { Shield, TrendingUp, Zap, Lock } from "lucide-react";

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  expectedApy: string;
  riskTier: string;
  historicalDrawdown: string;
  proofCompliancePct: number;
  icon: React.ReactNode;
}

const TEMPLATES: StrategyTemplate[] = [
  {
    id: "conservative-yield",
    name: "Conservative Yield",
    description: "Stable yield, low volatility exposure, high proof compliance.",
    expectedApy: "4–8%",
    riskTier: "Low",
    historicalDrawdown: "< 5%",
    proofCompliancePct: 100,
    icon: <Shield className="w-6 h-6 text-emerald-400" />,
  },
  {
    id: "balanced-growth",
    name: "Balanced Growth",
    description: "Mix of LP and limit orders; moderate risk.",
    expectedApy: "8–15%",
    riskTier: "Medium",
    historicalDrawdown: "5–12%",
    proofCompliancePct: 95,
    icon: <TrendingUp className="w-6 h-6 text-cyan-400" />,
  },
  {
    id: "aggressive-lp",
    name: "Aggressive LP",
    description: "Concentrated LP, higher volatility; proofs required for execution.",
    expectedApy: "15–30%",
    riskTier: "High",
    historicalDrawdown: "10–25%",
    proofCompliancePct: 90,
    icon: <Zap className="w-6 h-6 text-amber-400" />,
  },
  {
    id: "privacy-allocator",
    name: "Privacy Allocator",
    description: "Maximises private-pool allocation; private routing and selective disclosure.",
    expectedApy: "3–10%",
    riskTier: "Low–Medium",
    historicalDrawdown: "< 8%",
    proofCompliancePct: 100,
    icon: <Lock className="w-6 h-6 text-violet-400" />,
  },
];

interface StrategyTemplatesProps {
  onSelect?: (template: StrategyTemplate) => void;
}

export function StrategyTemplates({ onSelect }: StrategyTemplatesProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2">Strategy templates</h3>
      <p className="text-sm text-zinc-500">Click a card to apply configuration to the Vault. Expected APY, risk tier and proof compliance are indicative.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect?.(t)}
            className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 text-left hover:border-emerald-500/30 hover:bg-zinc-800/50 transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">{t.icon}<span className="font-semibold text-zinc-200">{t.name}</span></div>
            <p className="text-xs text-zinc-500 mb-4">{t.description}</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-zinc-500">Expected APY</span><span className="text-emerald-400/90">{t.expectedApy}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Risk tier</span><span className="text-zinc-300">{t.riskTier}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Historical drawdown</span><span className="text-zinc-400">{t.historicalDrawdown}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Proof compliance</span><span className="text-cyan-400/90">{t.proofCompliancePct}%</span></div>
            </div>
            <p className="mt-3 text-xs text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity">Apply to Vault</p>
          </button>
        ))}
      </div>
    </div>
  );
}

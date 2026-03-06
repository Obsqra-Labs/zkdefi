"use client";
import { Info, Shield, Link2, Brain } from "lucide-react";

interface ExplainabilityPanelProps {
  creditLine: {
    collateral_eth: number;
    collateral_line_eth: number;
    unsecured_cap_eth: number;
    total_line_eth: number;
    rate_bps: number;
    tier: number;
    letter_rating: string;
    credit_tier?: string;
    cross_chain_multiplier: number;
    collaborative_multiplier: number;
    predictive_credit?: { credit_class: string; model_used: string };
  };
}

const TIER_WEIGHTS: Record<number, number> = { 0: 0.0, 1: 0.5, 2: 1.0 };
const LETTER_WEIGHTS: Record<string, number> = { A: 1.0, B: 0.6, C: 0.3, D: 0.0 };
const CREDIT_WEIGHTS: Record<string, number> = { AAA: 1.5, AA: 1.2, A: 1.0, B: 0.5, C: 0.2 };
const BASE_UNSECURED_CAP = 5.0;

export function ExplainabilityPanel({ creditLine }: ExplainabilityPanelProps) {
  const isPredictive = !!creditLine.predictive_credit;
  const creditMethod = isPredictive ? creditLine.predictive_credit!.model_used : "formulaic";
  const tierWeight = TIER_WEIGHTS[creditLine.tier] ?? 0;
  const letterWeight = LETTER_WEIGHTS[creditLine.letter_rating] ?? 0;
  const creditWeight = CREDIT_WEIGHTS[creditLine.credit_tier ?? ""] ?? 0;
  const baseUnsecured = tierWeight * letterWeight * creditWeight * BASE_UNSECURED_CAP;
  const crossChainBoost = (creditLine.cross_chain_multiplier - 1.0) * baseUnsecured;
  const collabBoost = (creditLine.collaborative_multiplier - 1.0) * (baseUnsecured + crossChainBoost);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Info className="w-5 h-5 text-blue-400" /> Credit Line Explainability
      </h3>
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Scoring Method:</span>
        {isPredictive ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full text-xs font-medium text-purple-400">
            <Brain className="w-3 h-3" /> {creditMethod === "xgboost" ? "Predictive zkML" : "RISC Zero"}
          </div>
        ) : (
          <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/30 rounded-full text-xs font-medium text-blue-400">Formulaic</div>
        )}
      </div>
      {!isPredictive && (
        <div className="space-y-3 pt-3 border-t border-zinc-800">
          <div className="text-sm text-zinc-400 mb-2">Unsecured Capacity Formula:</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Base (tier × letter × credit × 5.0 ETH)</span>
              <span className="font-mono text-zinc-300">{baseUnsecured.toFixed(3)} ETH</span>
            </div>
            <div className="pl-4 space-y-1 text-xs text-zinc-500">
              <div className="flex justify-between"><span>Tier {creditLine.tier} weight:</span><span className="text-zinc-400">{tierWeight.toFixed(1)}x</span></div>
              <div className="flex justify-between"><span>Letter {creditLine.letter_rating} weight:</span><span className="text-zinc-400">{letterWeight.toFixed(1)}x</span></div>
              <div className="flex justify-between"><span>Credit {creditLine.credit_tier || "N/A"} weight:</span><span className="text-zinc-400">{creditWeight.toFixed(1)}x</span></div>
            </div>
            {creditLine.cross_chain_multiplier > 1.0 && (
              <div className="flex justify-between pt-2 border-t border-zinc-800">
                <span className="text-zinc-400 flex items-center gap-1.5"><Link2 className="w-3 h-3 text-blue-400" /> Cross-chain boost</span>
                <span className="font-mono text-emerald-400">+{crossChainBoost.toFixed(3)} ETH</span>
              </div>
            )}
            {creditLine.collaborative_multiplier > 1.0 && (
              <div className="flex justify-between"><span className="text-zinc-400">Credit graph boost</span><span className="font-mono text-purple-400">+{collabBoost.toFixed(3)} ETH</span></div>
            )}
            <div className="flex justify-between pt-2 border-t border-zinc-800 font-semibold">
              <span className="text-zinc-300">Total Unsecured</span>
              <span className="font-mono text-emerald-400">{creditLine.unsecured_cap_eth.toFixed(3)} ETH</span>
            </div>
          </div>
        </div>
      )}
      {isPredictive && (
        <div className="space-y-2 pt-3 border-t border-zinc-800">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Credit Class:</span>
            <span className="px-2 py-0.5 bg-purple-500/20 rounded text-purple-300 font-medium">{creditLine.predictive_credit!.credit_class}</span>
          </div>
          <div className="text-xs text-zinc-500">Credit line computed using {creditMethod === "xgboost" ? "XGBoost zkML (38 features)" : "RISC Zero"} with proof verification.</div>
        </div>
      )}
      <div className="space-y-2 pt-3 border-t border-zinc-800">
        <div className="text-sm text-zinc-400 mb-2">Collateral-backed Credit:</div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400 flex items-center gap-1.5"><Shield className="w-3 h-3 text-blue-400" /> {creditLine.collateral_eth.toFixed(3)} ETH staked × 80% LTV</span>
          <span className="font-mono text-blue-400">{creditLine.collateral_line_eth.toFixed(3)} ETH</span>
        </div>
      </div>
    </div>
  );
}

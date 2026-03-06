"use client";
import { Award, Lock, CheckCircle, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

interface SystemPerksPanelProps {
  completedProofs: string[];
  tier: number;
}

const ALL_PERKS = [
  { id: "tier1_access", title: "Standard Tier Access", description: "Manual approval for all transactions", requiredProofs: [] as string[], requiredTier: 1 },
  { id: "tier2_access", title: "Express Tier Access", description: "Autonomous execution enabled", requiredProofs: ["risk_passport"], requiredTier: 2 },
  { id: "higher_credit", title: "Enhanced Credit Line", description: "+20% unsecured capacity boost", requiredProofs: ["solvency"], requiredTier: 1 },
  { id: "unsecured_lending", title: "Unsecured Lending Access", description: "Borrow without collateral (up to limit)", requiredProofs: ["solvency", "risk_passport"], requiredTier: 2 },
  { id: "trading_fee_discount", title: "Trading Fee Discount", description: "0.5% → 0.3% on all swaps", requiredProofs: ["trader_performance"], requiredTier: 1 },
  { id: "leveraged_strategies", title: "Leveraged Strategies", description: "Up to 3x leverage on approved strategies", requiredProofs: ["trader_performance", "strategy_integrity"], requiredTier: 2 },
  { id: "custom_strategies", title: "Custom Strategy Deployment", description: "Deploy your own yield strategies", requiredProofs: ["strategy_integrity"], requiredTier: 2 },
  { id: "relayer_fee_discount", title: "Relayer Fee Discount", description: "50% off all relayer fees", requiredProofs: ["execution_integrity"], requiredTier: 1 },
  { id: "mev_protection", title: "MEV Protection Active", description: "Private execution with anti-sandwich", requiredProofs: ["execution_integrity"], requiredTier: 2 },
  { id: "liquidation_penalty", title: "Reduced Liquidation Penalty", description: "5% penalty instead of 10%", requiredProofs: ["solvency"], requiredTier: 1 },
];

export function SystemPerksPanel({ completedProofs, tier }: SystemPerksPanelProps) {
  const unlockedPerks = ALL_PERKS.filter((perk) => {
    const hasProofs = perk.requiredProofs.every((p) => completedProofs.includes(p));
    const hasTier = tier >= perk.requiredTier;
    return hasProofs && hasTier;
  });

  const availablePerks = ALL_PERKS.filter((perk) => {
    const hasProofs = perk.requiredProofs.every((p) => completedProofs.includes(p));
    const hasTier = tier >= perk.requiredTier;
    return !hasProofs || !hasTier;
  });

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Award className="w-5 h-5 text-amber-400" />
        System Perks
      </h3>

      {unlockedPerks.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-emerald-400 font-medium mb-2">Unlocked ({unlockedPerks.length})</div>
          {unlockedPerks.map((perk) => (
            <motion.div
              key={perk.id}
              className="flex items-start gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
            >
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-emerald-300 text-sm">{perk.title}</div>
                <div className="text-xs text-emerald-500/70 mt-0.5">{perk.description}</div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {availablePerks.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-zinc-800">
          <div className="text-sm text-zinc-400 font-medium mb-2">Available to Unlock ({availablePerks.length})</div>
          {availablePerks.map((perk) => {
            const missingProofs = perk.requiredProofs.filter((p) => !completedProofs.includes(p));
            const missingTier = tier < perk.requiredTier;

            return (
              <motion.div
                key={perk.id}
                className="flex items-start gap-3 p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                whileHover={{ scale: 1.01 }}
              >
                <Lock className="w-5 h-5 text-zinc-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-zinc-300 text-sm">{perk.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{perk.description}</div>
                  <div className="text-xs text-amber-500 mt-1.5">
                    Required: {missingProofs.length > 0 && `${missingProofs.join(", ")} proof`}
                    {missingProofs.length > 0 && missingTier && " + "}
                    {missingTier && `Tier ${perk.requiredTier}`}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0 mt-1" />
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

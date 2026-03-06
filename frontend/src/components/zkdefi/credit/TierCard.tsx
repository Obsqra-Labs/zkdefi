"use client";
import { Shield, TrendingUp, Lock, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { API_BASE } from "@/lib/api/client";
import { toastSuccess, toastError } from "@/lib/toast";

interface TierCardProps {
  address: string;
  tier: number;
  tierName: string;
  collateralEth: number;
  tenureDays: number;
  successfulTxns: number;
  onUpgradeComplete?: () => void;
}

const TIER_CONFIG = {
  0: { color: "blue", label: "Strict", icon: Lock, desc: "Relayer-only execution" },
  1: { color: "emerald", label: "Standard", icon: Shield, desc: "Manual approval required" },
  2: { color: "orange", label: "Express", icon: TrendingUp, desc: "Autonomous execution enabled" },
} as const;

export function TierCard({ address, tier, tierName, collateralEth, tenureDays, successfulTxns, onUpgradeComplete }: TierCardProps) {
  const [upgrading, setUpgrading] = useState(false);
  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG] || TIER_CONFIG[0];
  const Icon = config.icon;

  // Upgrade requirements
  const canUpgradeToTier1 = tier === 0 && tenureDays >= 7 && successfulTxns >= 3;
  const canUpgradeToTier2 = tier === 1 && collateralEth >= 1.0;

  const nextTierReq = tier === 0
    ? `7+ days & 3+ txns (${tenureDays}/7 days, ${successfulTxns}/3 txns)`
    : tier === 1
    ? `1+ ETH staked (${collateralEth.toFixed(3)}/1.0 ETH)`
    : "Max tier";

  async function handleUpgrade() {
    const targetTier = tier + 1;
    setUpgrading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/reputation/upgrade-tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          target_tier: targetTier,
          upgrade_proof_hash: "0x0", // TODO: Real proof hash when on-chain verification is enabled
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toastSuccess(`Upgraded to ${data.tier_name}!`);
        onUpgradeComplete?.();
      } else {
        const error = await res.json();
        toastError(error.detail || "Upgrade failed");
      }
    } catch (error) {
      console.error("Upgrade error:", error);
      toastError("Failed to upgrade tier");
    } finally {
      setUpgrading(false);
    }
  }

  return (
    <motion.div
      className={`bg-gradient-to-br from-${config.color}-500/10 to-${config.color}-600/5 border border-${config.color}-500/30 rounded-xl p-6`}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm text-zinc-400 mb-1">Access Tier</div>
          <div className={`text-3xl font-bold text-${config.color}-400 flex items-center gap-2`}>
            <Icon className="w-8 h-8" />
            {config.label}
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium bg-${config.color}-500/20 text-${config.color}-300`}>
          Tier {tier}
        </div>
      </div>
      <p className="text-sm text-zinc-400 mb-3">{config.desc}</p>
      
      {tier < 2 && (
        <div className="pt-3 border-t border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Next tier requires:</div>
          <div className="text-sm text-zinc-300">{nextTierReq}</div>
          {(canUpgradeToTier1 || canUpgradeToTier2) && (
            <button 
              onClick={handleUpgrade}
              disabled={upgrading}
              className="mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-xs rounded-lg transition-colors flex items-center gap-2"
            >
              {upgrading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Upgrading...
                </>
              ) : (
                `Upgrade to Tier ${tier + 1}`
              )}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

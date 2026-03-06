"use client";
import { Coins, TrendingUp, Shield, Link2 } from "lucide-react";
import { motion } from "framer-motion";

interface CreditLineVisualizerProps {
  collateralEth: number;
  collateralLineEth: number;
  unsecuredCapEth: number;
  totalLineEth: number;
  rateBps: number;
  tier: number;
  letterRating: string;
  creditTier?: string;
  crossChainMultiplier: number;
  collaborativeMultiplier: number;
}

export function CreditLineVisualizer(props: CreditLineVisualizerProps) {
  const {
    collateralEth,
    collateralLineEth,
    unsecuredCapEth,
    totalLineEth,
    rateBps,
    tier,
    letterRating,
    creditTier,
    crossChainMultiplier,
    collaborativeMultiplier,
  } = props;

  const collateralPct = totalLineEth > 0 ? (collateralLineEth / totalLineEth) * 100 : 0;
  const unsecuredPct = totalLineEth > 0 ? (unsecuredCapEth / totalLineEth) * 100 : 0;

  const hasBoost = crossChainMultiplier > 1.0 || collaborativeMultiplier > 1.0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Coins className="w-5 h-5 text-blue-400" />
        Credit Line
      </h3>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-zinc-400">Total Available</span>
        <span className="text-3xl font-bold text-emerald-400">{totalLineEth.toFixed(2)} ETH</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400 flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-blue-400" />
            Collateral-backed (80% LTV)
          </span>
          <span className="font-medium text-zinc-200">{collateralLineEth.toFixed(2)} ETH</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Unsecured (reputation-based)
          </span>
          <span className="font-medium text-zinc-200">{unsecuredCapEth.toFixed(2)} ETH</span>
        </div>
      </div>

      <div className="h-8 bg-zinc-800 rounded-lg overflow-hidden flex">
        {collateralPct > 0 && (
          <motion.div
            className="bg-blue-500 h-full flex items-center justify-center text-xs font-medium text-white"
            initial={{ width: 0 }}
            animate={{ width: `${collateralPct}%` }}
            transition={{ duration: 0.5 }}
          >
            {collateralPct >= 15 && `${collateralPct.toFixed(0)}%`}
          </motion.div>
        )}
        {unsecuredPct > 0 && (
          <motion.div
            className="bg-emerald-500 h-full flex items-center justify-center text-xs font-medium text-white"
            initial={{ width: 0 }}
            animate={{ width: `${unsecuredPct}%` }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            {unsecuredPct >= 15 && `${unsecuredPct.toFixed(0)}%`}
          </motion.div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
        <span className="text-sm text-zinc-400">Borrow Rate</span>
        <span className="text-lg font-semibold text-amber-400">{(rateBps / 100).toFixed(2)}%</span>
      </div>

      {hasBoost && (
        <div className="pt-2 border-t border-zinc-800 space-y-1">
          <div className="text-xs text-zinc-500 mb-1.5">Active Boosts:</div>
          {crossChainMultiplier > 1.0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                Cross-chain
              </span>
              <span className="text-emerald-400 font-medium">{crossChainMultiplier.toFixed(2)}x</span>
            </div>
          )}
          {collaborativeMultiplier > 1.0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Credit graph</span>
              <span className="text-purple-400 font-medium">{collaborativeMultiplier.toFixed(2)}x</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

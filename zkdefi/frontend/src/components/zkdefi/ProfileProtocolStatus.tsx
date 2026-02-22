"use client";

import { Lock, Coins, Send, ArrowUp } from "lucide-react";

interface ProfileProtocolStatusProps {
  tierName: string;
  collateralEth: number;
  canUseRelayer: boolean;
  canUpgrade: boolean;
  upgradeMessage?: string;
}

export function ProfileProtocolStatus({
  tierName,
  collateralEth,
  canUseRelayer,
  canUpgrade,
  upgradeMessage,
}: ProfileProtocolStatusProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <div className="text-xs text-zinc-400 mb-1 flex items-center gap-1">
          <Lock className="w-3.5 h-3.5" /> Tier
        </div>
        <div className="text-lg font-semibold text-white">{tierName}</div>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <div className="text-xs text-zinc-400 mb-1 flex items-center gap-1">
          <Coins className="w-3.5 h-3.5" /> Collateral
        </div>
        <div className="text-lg font-semibold text-white">{collateralEth.toFixed(4)} ETH</div>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <div className="text-xs text-zinc-400 mb-1 flex items-center gap-1">
          <Send className="w-3.5 h-3.5" /> Relayer
        </div>
        <div className={`text-lg font-semibold ${canUseRelayer ? "text-emerald-400" : "text-zinc-500"}`}>
          {canUseRelayer ? "Available" : "Locked"}
        </div>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <div className="text-xs text-zinc-400 mb-1 flex items-center gap-1">
          <ArrowUp className="w-3.5 h-3.5" /> Upgrade
        </div>
        <div className={`text-sm font-medium ${canUpgrade ? "text-emerald-400" : "text-zinc-500"}`}>
          {canUpgrade ? "Eligible" : upgradeMessage ?? "—"}
        </div>
      </div>
    </div>
  );
}

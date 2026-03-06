"use client";

import { Lock } from "lucide-react";

export type TierLevel = 0 | 1 | 2;

const TIER_NAMES: Record<TierLevel, string> = {
  0: "Strict",
  1: "Standard",
  2: "Express",
};

const TIER_COLORS: Record<TierLevel, string> = {
  0: "text-blue-400 bg-blue-500/20 border-blue-500/40",
  1: "text-emerald-400 bg-emerald-500/20 border-emerald-500/40",
  2: "text-orange-400 bg-orange-500/20 border-orange-500/40",
};

/** Short "what leaks" per tier for tooltip/copy */
export const TIER_VISIBILITY: Record<TierLevel, string> = {
  0: "Minimal on-chain footprint; proofs only.",
  1: "Relayer may see recipient/amount for withdrawals.",
  2: "Express: faster flows; same visibility as Standard.",
};

interface TierBadgeProps {
  tier: TierLevel | number;
  tierName?: string;
  showIcon?: boolean;
  showVisibilityHint?: boolean;
  className?: string;
}

export function TierBadge({
  tier,
  tierName,
  showIcon = true,
  showVisibilityHint = false,
  className = "",
}: TierBadgeProps) {
  const t = (tier === 0 || tier === 1 || tier === 2 ? tier : 0) as TierLevel;
  const name = tierName ?? TIER_NAMES[t];
  const color = TIER_COLORS[t];
  const visibility = TIER_VISIBILITY[t];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium ${color} ${className}`}
      title={showVisibilityHint ? visibility : undefined}
    >
      {showIcon && <Lock className="w-3 h-3 opacity-80" />}
      {name}
      {showVisibilityHint && (
        <span className="sr-only"> — {visibility}</span>
      )}
    </span>
  );
}

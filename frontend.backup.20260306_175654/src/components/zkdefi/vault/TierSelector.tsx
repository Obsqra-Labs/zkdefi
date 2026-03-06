"use client";

import { useState } from "react";
import { Shield, TreePine, Hash, BookLock, Info } from "lucide-react";
import type { PrivacyMethod, VaultCommitment } from "@/hooks/usePrivacyVault";

interface TierSelectorProps {
  selected: PrivacyMethod;
  onSelect: (method: PrivacyMethod) => void;
  commitments: VaultCommitment[];
}

interface TierConfig {
  method: PrivacyMethod;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  tooltip: string;
  strength: number;
}

const TIERS: TierConfig[] = [
  {
    method: "commitment_shield",
    label: "Commitment Shield",
    icon: Shield,
    description: "Amount hidden via Pedersen commitment",
    tooltip:
      "Your deposit amount is hidden behind a cryptographic commitment. The deposit event is visible on-chain but the value is not. Fastest, lowest gas.",
    strength: 1,
  },
  {
    method: "nullifier_set",
    label: "Nullifier Set",
    icon: TreePine,
    description: "Anonymity set with unlinkable withdrawals",
    tooltip:
      "Your deposit joins an anonymity set. Withdrawals use a nullifier so no one can link your withdraw to your deposit. Supports selective disclosure.",
    strength: 2,
  },
  {
    method: "hashed_proof",
    label: "Hashed Proof",
    icon: Hash,
    description: "Prove claims without revealing values",
    tooltip:
      "Prove things about your position (balance above threshold, pool membership, tenure) without revealing the values themselves. Claims are verified against hashed inputs.",
    strength: 3,
  },
  {
    method: "dark_ledger",
    label: "Dark Ledger",
    icon: BookLock,
    description: "No on-chain footprint, operator pattern",
    tooltip:
      "Maximum privacy. Your position is tracked in an encrypted off-chain ledger. No individual deposit/withdraw events on-chain. The protocol operates on your behalf.",
    strength: 4,
  },
];

export function TierSelector({ selected, onSelect, commitments }: TierSelectorProps) {
  const [activeTooltip, setActiveTooltip] = useState<PrivacyMethod | null>(null);

  function countForMethod(method: PrivacyMethod): number {
    return commitments.filter((c) => c.method === method).length;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {TIERS.map((tier) => {
        const isSelected = selected === tier.method;
        const count = countForMethod(tier.method);
        const Icon = tier.icon;

        return (
          <button
            key={tier.method}
            type="button"
            onClick={() => onSelect(tier.method)}
            className={`relative rounded-xl border p-3 text-left transition-all ${
              isSelected
                ? "border-blue-500 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
            }`}
          >
            {/* Info tooltip trigger -- hover on desktop, tap on mobile */}
            <div
              className="absolute top-2.5 right-2.5"
              onMouseEnter={() => setActiveTooltip(tier.method)}
              onMouseLeave={() => setActiveTooltip(null)}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTooltip((prev) => (prev === tier.method ? null : tier.method));
              }}
            >
              <Info className="w-3.5 h-3.5 text-white/30 hover:text-white/60 transition-colors" />
              {activeTooltip === tier.method && (
                <div className="absolute right-0 top-full mt-1 w-64 rounded-lg bg-slate-800 border border-white/10 p-3 text-xs text-white/70 z-50 leading-relaxed shadow-xl">
                  {tier.tooltip}
                  <span className="block mt-1.5 text-white/30 md:hidden">Tap again to close</span>
                </div>
              )}
            </div>

            <Icon
              className={`w-5 h-5 mb-2 ${isSelected ? "text-blue-400" : "text-white/50"}`}
            />

            <div className="text-sm font-medium text-white mb-0.5">{tier.label}</div>
            <div className="text-xs text-white/40 mb-3 pr-4">{tier.description}</div>

            <div className="flex items-center justify-between">
              {/* Strength dots */}
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((dot) => (
                  <span
                    key={dot}
                    className={`w-2 h-2 rounded-full ${
                      dot <= tier.strength
                        ? isSelected
                          ? "bg-blue-400"
                          : "bg-white/40"
                        : "bg-white/10"
                    }`}
                  />
                ))}
              </div>

              {count > 0 && (
                <span className="text-[10px] text-white/30">
                  {count} position{count !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

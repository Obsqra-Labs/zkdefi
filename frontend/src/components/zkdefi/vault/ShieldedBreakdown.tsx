"use client";

/**
 * ShieldedBreakdown — reusable privacy-method breakdown widget.
 *
 * Shows commitment totals grouped by privacy method + asset.
 * Designed for the Capital Ledger left-rail but exported for
 * re-use in VaultSurface, PositionsOverview, agent pages, etc.
 */

import type { VaultCommitment, PrivacyMethod } from "@/hooks/usePrivacyVault";
import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Public helpers (also useful standalone)
// ---------------------------------------------------------------------------

export const METHOD_LABELS: Record<string, string> = {
  commitment_shield: "Shielded",
  nullifier_set: "Nullifier-Set",
  hashed_proof: "Hash-Proof",
  dark_ledger: "Dark Ledger",
};

export function formatWei(weiStr: string, asset: string): string {
  try {
    const v = BigInt(weiStr);
    const decimals = asset === "ETH" ? 18 : 18; // STRK / strkBTC also 18
    const whole = v / BigInt(10 ** decimals);
    const frac = v % BigInt(10 ** decimals);
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4);
    return `${whole}.${fracStr}`;
  } catch {
    return weiStr;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShieldedSummaryRow {
  method: string;
  asset: string;
  total_wei: bigint;
  count: number;
}

export interface ShieldedBreakdownProps {
  commitments: VaultCommitment[];
  /** Only show these methods (default: all non-dark_ledger) */
  methods?: PrivacyMethod[];
  /** Additional CSS classes on the root div */
  className?: string;
}

// ---------------------------------------------------------------------------
// Hook: aggregate commitments by method + asset
// ---------------------------------------------------------------------------

export function useShieldedSummary(
  commitments: VaultCommitment[],
  methods?: PrivacyMethod[],
): ShieldedSummaryRow[] {
  return useMemo(() => {
    const filtered = methods
      ? commitments.filter((c) => methods.includes(c.method))
      : commitments.filter((c) => c.method !== "dark_ledger");

    const map = new Map<string, ShieldedSummaryRow>();
    for (const c of filtered) {
      const key = `${c.method}::${c.asset}`;
      const existing = map.get(key);
      if (existing) {
        existing.total_wei += BigInt(c.amount_wei);
        existing.count += 1;
      } else {
        map.set(key, { method: c.method, asset: c.asset, total_wei: BigInt(c.amount_wei), count: 1 });
      }
    }
    return Array.from(map.values());
  }, [commitments, methods]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShieldedBreakdown({ commitments, methods, className }: ShieldedBreakdownProps) {
  const rows = useShieldedSummary(commitments, methods);

  if (rows.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
        Shielded by method
      </p>
      <div className="space-y-1">
        {rows.map((s) => (
          <div
            key={`${s.method}::${s.asset}`}
            className="flex items-center justify-between text-[11px] py-0.5 px-2 rounded bg-emerald-900/15"
          >
            <div>
              <span className="text-emerald-300">
                {METHOD_LABELS[s.method] || s.method}
              </span>
              <span className="text-zinc-600 ml-1">{s.asset}</span>
            </div>
            <div className="text-right">
              <span className="text-zinc-300 font-mono">
                {formatWei(s.total_wei.toString(), s.asset)}
              </span>
              {s.count > 1 && (
                <span className="text-zinc-600 ml-1">×{s.count}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

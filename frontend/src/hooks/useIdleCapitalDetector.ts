"use client";

import { useState, useEffect, useRef } from "react";
import { getVaultSummary, fetchNarration } from "@/lib/api/strategies";
import { useLivePrice } from "@/hooks/useLivePrice";

/* ────────────────────────────────────────────────────────────────────── */
/* Types                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export interface IdleCapitalResult {
  idleAmountWei: number;
  idleAmountUsd: number;
  totalBalanceWei: number;
  deployedWei: number;
  pctIdle: number;
  narration: string;
  suggestDeploy: boolean;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Hook                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

const IDLE_THRESHOLD_PCT = 10; // suggest if >10% idle

export function useIdleCapitalDetector(
  ownerAddress: string | undefined,
  bestApy: number = 8,
  pollInterval: number = 60_000,
): { data: IdleCapitalResult | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<IdleCapitalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Get live STRK/USD price from oracle
  const { prices: livePrices } = useLivePrice(30_000); // poll every 30s
  const strkUsd = livePrices.strk_usd ?? 0.50; // fallback while loading

  useEffect(() => {
    if (!ownerAddress) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let consecutiveZeros = 0;

    const check = async () => {
      try {
        const vault = await getVaultSummary(ownerAddress);
        const total = vault.net_balance_wei;

        // Position guard: skip expensive narration call when wallet is empty
        if (total <= 0) {
          consecutiveZeros++;
          if (!cancelled) {
            setData({ idleAmountWei: 0, idleAmountUsd: 0, totalBalanceWei: 0, deployedWei: 0, pctIdle: 0, narration: "", suggestDeploy: false });
            setError(null);
          }
          return;
        }
        consecutiveZeros = 0;

        const idle = total - vault.total_deployed_wei;
        const idleUsd = (idle / 1e18) * strkUsd; // Convert STRK wei to USD using live price
        const pctIdle = total > 0 ? (idle / total) * 100 : 0;
        const suggestDeploy = pctIdle > IDLE_THRESHOLD_PCT && idleUsd > 1;

        let narration = "";
        if (suggestDeploy) {
          try {
            const resp = await fetchNarration("idle_capital", {
              idle_amount: idleUsd,
              risk_profile: "balanced", // default; caller overrides if needed
              best_apy: bestApy,
            });
            narration = resp.narration;
          } catch {
            const monthly = (idleUsd * bestApy) / 100 / 12;
            narration = `$${idleUsd.toFixed(0)} idle. Deploy at ${bestApy.toFixed(1)}% APY for ~$${monthly.toFixed(0)}/mo.`;
          }
        }

        if (!cancelled) {
          setData({
            idleAmountWei: idle,
            idleAmountUsd: idleUsd,
            totalBalanceWei: total,
            deployedWei: vault.total_deployed_wei,
            pctIdle,
            narration,
            suggestDeploy,
          });
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to fetch vault summary");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();
    timerRef.current = setInterval(check, pollInterval);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, [ownerAddress, bestApy, pollInterval, strkUsd]);

  return { data, loading, error };
}

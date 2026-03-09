"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";

export type AdapterHealth = "HEALTHY" | "DEGRADED" | "CIRCUIT_BREAKER" | "DISABLED";

export interface AdapterSummary {
  name: string;
  health: AdapterHealth;
  value: number;
}

interface AdapterRegistryState {
  adapters: AdapterSummary[];
  loading: boolean;
}

/**
 * Fetch live adapter health from market context + pool metrics.
 * Falls back to static defaults if the API is unreachable.
 */
export function useAdapterRegistry(): AdapterRegistryState {
  const [loading, setLoading] = useState(true);
  const [adapters, setAdapters] = useState<AdapterSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fetch market context to check if Ekubo + staking are responding
        const ctx = await apiFetch<any>(
          "/api/v1/zkdefi/trade-desk/v2/market/context",
        );

        const ekuboUp = ctx?.prices?.ETH != null;
        const stakingUp = ctx?.stakingApy != null && ctx.stakingApy > 0;

        // Build adapter summaries with real health status
        const result: AdapterSummary[] = [
          {
            name: "Ekubo LP",
            health: ekuboUp ? "HEALTHY" : "DEGRADED",
            value: 45,
          },
          {
            name: "Lending",
            health: ekuboUp ? "HEALTHY" : "DEGRADED",
            value: 30,
          },
          {
            name: "Staking",
            health: stakingUp ? "HEALTHY" : "DEGRADED",
            value: 20,
          },
        ];

        // Try to get real TVL weights from pool metrics
        try {
          const pools = await apiFetch<{ opportunities: any[] }>(
            "/api/v1/zkdefi/trade-desk/v2/opportunities?type=lp,lending,staking&limit=50",
          );
          if (pools?.opportunities?.length) {
            const totalTvl = pools.opportunities.reduce(
              (s: number, o: any) => s + (o.tvl_usd || 0),
              0,
            );
            if (totalTvl > 0) {
              const lpTvl = pools.opportunities
                .filter((o: any) => o.type === "lp" || o.type === "swap")
                .reduce((s: number, o: any) => s + (o.tvl_usd || 0), 0);
              const lendTvl = pools.opportunities
                .filter((o: any) => o.type === "lending")
                .reduce((s: number, o: any) => s + (o.tvl_usd || 0), 0);
              const stakeTvl = pools.opportunities
                .filter((o: any) => o.type === "staking")
                .reduce((s: number, o: any) => s + (o.tvl_usd || 0), 0);

              result[0].value = Math.round((lpTvl / totalTvl) * 100) || 45;
              result[1].value = Math.round((lendTvl / totalTvl) * 100) || 30;
              result[2].value = Math.round((stakeTvl / totalTvl) * 100) || 20;
            }
          }
        } catch {
          // Keep default value splits
        }

        if (!cancelled) setAdapters(result);
      } catch {
        if (!cancelled) {
          setAdapters([
            { name: "Ekubo LP", health: "DEGRADED", value: 45 },
            { name: "Lending", health: "DEGRADED", value: 30 },
            { name: "Staking", health: "DEGRADED", value: 20 },
          ]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => ({ adapters, loading }), [adapters, loading]);
}

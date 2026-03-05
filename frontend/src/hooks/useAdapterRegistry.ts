"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api/client";

export type AdapterHealth = "HEALTHY" | "DEGRADED" | "CIRCUIT_BREAKER" | "DISABLED";
export type AdapterType = "first-party" | "community";

export interface Adapter {
  name: string;
  address: string;
  type: AdapterType;
  health: AdapterHealth;
  apyBps: number;
  value: number;
  maxAllocationBps: number;
}

export interface AdapterRegistryState {
  adapters: Adapter[];
  loading: boolean;
}

const FIRST_PARTY_ADAPTERS: Adapter[] = [
  {
    name: "Ekubo LP",
    address: "0x0",
    type: "first-party",
    health: "HEALTHY",
    apyBps: 450,
    value: 0,
    maxAllocationBps: 4000,
  },
  {
    name: "Lending",
    address: "0x0",
    type: "first-party",
    health: "HEALTHY",
    apyBps: 320,
    value: 0,
    maxAllocationBps: 3000,
  },
  {
    name: "Staking",
    address: "0x0",
    type: "first-party",
    health: "HEALTHY",
    apyBps: 280,
    value: 0,
    maxAllocationBps: 3000,
  },
];

interface VaultStatsResponse {
  ekubo_pct?: number;
  lending_pct?: number;
  idle_pct?: number;
  ekubo_apy_bps?: number;
  lending_apy_bps?: number;
  staking_apy_bps?: number;
}

export function useAdapterRegistry(): AdapterRegistryState {
  const [state, setState] = useState<AdapterRegistryState>({
    adapters: FIRST_PARTY_ADAPTERS,
    loading: true,
  });

  const fetchAdapters = useCallback(async () => {
    try {
      const stats = await apiFetch<VaultStatsResponse>(`/api/v1/zkdefi/private-yield/vault/stats`);
      if (stats) {
        const updated = FIRST_PARTY_ADAPTERS.map((a) => {
          if (a.name === "Ekubo LP" && stats.ekubo_pct !== undefined) {
            return { ...a, value: stats.ekubo_pct, apyBps: stats.ekubo_apy_bps ?? a.apyBps };
          }
          if (a.name === "Lending" && stats.lending_pct !== undefined) {
            return { ...a, value: stats.lending_pct, apyBps: stats.lending_apy_bps ?? a.apyBps };
          }
          if (a.name === "Staking") {
            const stakingPct = Math.max(0, 100 - (stats.ekubo_pct ?? 0) - (stats.lending_pct ?? 0) - (stats.idle_pct ?? 0));
            return { ...a, value: stakingPct, apyBps: stats.staking_apy_bps ?? a.apyBps };
          }
          return a;
        });
        setState({ adapters: updated, loading: false });
      } else {
        setState((prev) => ({ ...prev, loading: false }));
      }
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchAdapters();
    const interval = setInterval(fetchAdapters, 60_000);
    return () => clearInterval(interval);
  }, [fetchAdapters]);

  return state;
}

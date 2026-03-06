"use client";

import { useMemo } from "react";

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

export function useAdapterRegistry(): AdapterRegistryState {
  return useMemo(
    () => ({
      adapters: [
        { name: "Ekubo LP", health: "HEALTHY", value: 45 },
        { name: "Lending", health: "HEALTHY", value: 30 },
        { name: "Staking", health: "HEALTHY", value: 20 },
      ],
      loading: false,
    }),
    [],
  );
}

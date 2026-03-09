"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";

type VaultRuntimeState =
  | "ACTIVE"
  | "PAUSED"
  | "COOLDOWN"
  | "PENDING_REBALANCE"
  | "EMERGENCY";

interface ProofsState {
  loaded: boolean;
  total: number;
}

interface VaultControllerSnapshot {
  proofsState: ProofsState;
  pendingProposal: boolean;
  cooldownRemaining: number;
  vaultState: VaultRuntimeState;
  loading: boolean;
}

/**
 * Fetch real vault status from `/api/v1/zkdefi/vault/status`.
 * Falls back to a safe default when the address is missing or the API errors.
 */
export function useVaultController(address?: string): VaultControllerSnapshot {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    allocations: number;
    apy: number;
    state: VaultRuntimeState;
  } | null>(null);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    apiFetch<any>(`/api/v1/zkdefi/vault/status?user_address=${address}`)
      .then((res) => {
        if (cancelled) return;
        const allocs = res?.allocations ?? [];
        const hasRebalance = allocs.some(
          (a: any) => a.status === "pending_rebalance",
        );
        setData({
          allocations: allocs.length,
          apy: res?.apy_estimate ?? 0,
          state: hasRebalance ? "PENDING_REBALANCE" : "ACTIVE",
        });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return useMemo<VaultControllerSnapshot>(
    () => ({
      proofsState: {
        loaded: Boolean(data),
        total: data?.allocations ?? 0,
      },
      pendingProposal: false,
      cooldownRemaining: 0,
      vaultState: data?.state ?? "ACTIVE",
      loading,
    }),
    [data, loading],
  );
}

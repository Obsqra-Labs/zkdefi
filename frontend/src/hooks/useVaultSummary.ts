"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";

export interface VaultSummary {
  loading: boolean;
  total_usd: number;
  strk_balance: number;
  eth_balance: number;
}

const DEFAULTS: VaultSummary = {
  loading: true,
  total_usd: 0,
  strk_balance: 0,
  eth_balance: 0,
};

/**
 * Fetch aggregate vault balances for the given address.
 *
 * Tries the V2 vault summary endpoint first, then falls back to the
 * legacy collateral/health endpoint so we always return something.
 */
export function useVaultSummary(address: string | undefined): VaultSummary {
  const [state, setState] = useState<VaultSummary>(DEFAULTS);

  useEffect(() => {
    if (!address) {
      setState({ ...DEFAULTS, loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        // Try V2 vault summary first
        const d = await apiFetch<Record<string, unknown>>(
          `/api/v2/vault/summary/${address}`,
        ).catch(() => null);

        if (cancelled) return;

        if (d && typeof d === "object") {
          setState({
            loading: false,
            total_usd: Number(d.total_usd ?? d.total_value_usd ?? 0),
            strk_balance: Number(d.strk_balance ?? d.strk ?? 0) / 1e18,
            eth_balance: Number(d.eth_balance ?? d.eth ?? 0) / 1e18,
          });
          return;
        }

        // Fallback: collateral health endpoint
        const h = await apiFetch<Record<string, unknown>>(
          `/api/v1/zkdefi/collateral/health/${address}`,
        ).catch(() => null);

        if (cancelled) return;

        if (h && typeof h === "object") {
          setState({
            loading: false,
            total_usd: Number(h.total_collateral_usd ?? 0),
            strk_balance: Number(h.strk_collateral_wei ?? 0) / 1e18,
            eth_balance: Number(h.eth_collateral_wei ?? 0) / 1e18,
          });
          return;
        }

        setState({ ...DEFAULTS, loading: false });
      } catch {
        if (!cancelled) setState({ ...DEFAULTS, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return state;
}

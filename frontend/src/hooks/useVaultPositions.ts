"use client";

/**
 * useVaultPositions — shared hook for deployed capital positions.
 *
 * Fetches from /api/v1/zkdefi/position/{address} and normalizes into a
 * simple list of deployed positions.
 */

import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api/client";

export interface DeployedPosition {
  venue: string;
  pair: string;
  value_usd: number;
  apy_pct: number;
  status: string;
}

export function useVaultPositions(address: string | undefined): {
  positions: DeployedPosition[];
  loading: boolean;
} {
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<DeployedPosition[]>([]);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      setPositions([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<any>(`/api/v1/zkdefi/position/${address}?protocol_id=0`)
      .then((res) => {
        if (cancelled) return;
        if (res?.positions && Array.isArray(res.positions)) {
          setPositions(
            res.positions.map((p: any) => ({
              venue: p.venue || p.protocol || "Unknown",
              pair: p.pair || p.token || "",
              value_usd: p.value_usd || 0,
              apy_pct: (p.apy_bps || 0) / 100,
              status: p.status || "active",
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setPositions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return useMemo(() => ({ positions, loading }), [positions, loading]);
}

"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";

export interface HealthPassport {
  loading: boolean;
  tier: number;
  tier_name: string;
  trust_score: number;
  proof_count: number;
}

const DEFAULTS: HealthPassport = {
  loading: true,
  tier: 0,
  tier_name: "Unranked",
  trust_score: 0,
  proof_count: 0,
};

const TIER_NAMES: Record<number, string> = {
  0: "Unranked",
  1: "Verified",
  2: "Trusted",
  3: "Guardian",
};

/**
 * Fetch the user's reputation / health data from the backend.
 */
export function useHealthPassport(address: string | undefined): HealthPassport {
  const [state, setState] = useState<HealthPassport>(DEFAULTS);

  useEffect(() => {
    if (!address) {
      setState({ ...DEFAULTS, loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    apiFetch<Record<string, unknown>>(`/api/v1/zkdefi/reputation/user/${address}`)
      .then((d) => {
        if (cancelled) return;
        const tier = Number(d?.tier ?? 0);
        setState({
          loading: false,
          tier,
          tier_name: (d?.tier_name as string) ?? TIER_NAMES[tier] ?? TIER_NAMES[0]!,
          trust_score: Number(d?.reputation_score ?? d?.trust_score ?? 0),
          proof_count: Number(d?.proof_count ?? d?.proofs_generated ?? 0),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ ...DEFAULTS, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return state;
}

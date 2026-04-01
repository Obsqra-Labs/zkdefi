"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { PortablePassportProfile } from "@/lib/passport/portable";

const PPP_CACHE_PREFIX = "zkdefi:ppp:";
const PPP_CACHE_TTL_MS = 60_000; // 60 seconds

/** Timeout for PPP endpoint — aggregates multiple sources so needs headroom. */
const PPP_TIMEOUT_MS = 15_000;

interface UsePortablePassportResult {
  passport: PortablePassportProfile | null;
  loading: boolean;
  error: ApiError | null;
  refetch: (signal?: AbortSignal) => Promise<void>;
}

function getCachedPPP(address: string): PortablePassportProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${PPP_CACHE_PREFIX}${address.toLowerCase()}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: PortablePassportProfile; ts: number };
    if (Date.now() - ts > PPP_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(`${PPP_CACHE_PREFIX}${address.toLowerCase()}`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedPPP(address: string, data: PortablePassportProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `${PPP_CACHE_PREFIX}${address.toLowerCase()}`,
      JSON.stringify({ data, ts: Date.now() }),
    );
  } catch {
    // sessionStorage full or unavailable — non-fatal
  }
}

/**
 * Canonical hook for loading a Portable Passport Profile.
 *
 * Replaces `useRiskProfileV2` and ReceiptOS `fetchProfile()` with a single
 * data source consumed by both `/profile` and `/passport`.
 */
export function usePortablePassport(address: string | undefined): UsePortablePassportResult {
  const [passport, setPassport] = useState<PortablePassportProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const refetch = useCallback(
    async (signal?: AbortSignal) => {
      if (!address) return;

      // Use cached version if fresh
      const cached = getCachedPPP(address);
      if (cached) {
        setPassport(cached);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<PortablePassportProfile>(
          `/api/v1/passport/portable/${address}`,
          { timeoutMs: PPP_TIMEOUT_MS, signal },
        );
        setCachedPPP(address, data);
        setPassport(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiError ? err : null);
        setPassport(null);
      } finally {
        setLoading(false);
      }
    },
    [address],
  );

  useEffect(() => {
    if (!address) {
      setPassport(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    refetch(ac.signal);
    return () => ac.abort();
  }, [address, refetch]);

  return { passport, loading, error, refetch };
}

"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "@/lib/api/client";

export interface LivePrices {
  strk_eth: number | null;
  strk_usd: number | null;
  eth_usd: number | null;
  tick: number | null;
  source: string;
  cached_at: string | null;
}

const EMPTY: LivePrices = {
  strk_eth: null,
  strk_usd: null,
  eth_usd: null,
  tick: null,
  source: "loading",
  cached_at: null,
};

/**
 * Polls `/api/v1/strategies/price/live` every `intervalMs` (default 15 s).
 * Returns the latest live STRK/ETH prices + tick from the Ekubo oracle.
 */
export function useLivePrice(intervalMs: number = 15_000) {
  const [prices, setPrices] = useState<LivePrices>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/price/live`);
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail ?? `HTTP ${res.status}`);
      }
      const data: LivePrices = await res.json();
      setPrices(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to fetch prices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    timerRef.current = setInterval(fetchPrices, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchPrices, intervalMs]);

  return { prices, loading, error, refresh: fetchPrices };
}

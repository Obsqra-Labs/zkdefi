"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api/client";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";

const POLL_INTERVAL = 30_000; // 30s
const API_URL = "/api/v1/zkdefi/trade-desk/v2/opportunities";

interface UseOpportunitiesResult {
  opportunities: UnifiedOpportunity[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useOpportunities(limit = 50): UseOpportunitiesResult {
  const [opportunities, setOpportunities] = useState<UnifiedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const fetchOpps = useCallback(async () => {
    try {
      const res = await apiFetch<any>(`${API_URL}?limit=${limit}`);
      const opps: UnifiedOpportunity[] = Array.isArray(res?.opportunities)
        ? res.opportunities
        : Array.isArray(res)
          ? res
          : [];
      setOpportunities(opps);
      setError(null);
    } catch (e: any) {
      console.warn("useOpportunities fetch failed:", e);
      setError(e?.message ?? "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchOpps();
    timerRef.current = setInterval(fetchOpps, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchOpps]);

  return { opportunities, loading, error, refresh: fetchOpps };
}

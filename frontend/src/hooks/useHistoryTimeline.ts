"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getHistoryTimeline } from "@/lib/api/state";
import { HistoryTimelineEvent } from "@/types/ekubo";

export function useHistoryTimeline(address?: string, invalidateKey?: number) {
  const [events, setEvents] = useState<HistoryTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setEvents([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await getHistoryTimeline(address);
      setEvents(Array.isArray(response.events) ? response.events : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history timeline");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cross-tab invalidation: when any tab triggers invalidateTabs(), refetch
  useEffect(() => {
    if (address != null && invalidateKey != null && invalidateKey > 0) {
      void refresh();
    }
  }, [invalidateKey, address, refresh]);

  useEffect(() => {
    if (!address) return;
    const interval = window.setInterval(() => {
      void refresh();
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [address, refresh]);

  return useMemo(
    () => ({
      events,
      loading,
      error,
      refresh,
    }),
    [error, events, loading, refresh],
  );
}

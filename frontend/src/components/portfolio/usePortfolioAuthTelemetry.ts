"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchPortfolioAuthTelemetrySummary,
  type PortfolioAuthTelemetrySummary,
} from "./api";

type UsePortfolioAuthTelemetryParams = {
  address: string | undefined;
  enabled: boolean;
  windowSec?: number;
  pollIntervalMs?: number;
};

export function usePortfolioAuthTelemetry({
  address,
  enabled,
  windowSec = 24 * 60 * 60,
  pollIntervalMs = 45_000,
}: UsePortfolioAuthTelemetryParams) {
  const [summary, setSummary] = useState<PortfolioAuthTelemetrySummary | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !address) return;
    setLoading(true);
    try {
      const next = await fetchPortfolioAuthTelemetrySummary(windowSec);
      setSummary(next);
    } catch {
      // Keep portfolio shell usable if telemetry is temporarily unavailable.
    } finally {
      setLoading(false);
    }
  }, [address, enabled, windowSec]);

  useEffect(() => {
    if (enabled && address) return;
    setSummary(null);
    setLoading(false);
  }, [address, enabled]);

  useEffect(() => {
    if (!enabled || !address) return;
    void refresh();
  }, [address, enabled, refresh]);

  useEffect(() => {
    if (!enabled || !address) return;
    const interval = setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [address, enabled, pollIntervalMs, refresh]);

  return {
    authTelemetrySummary: summary,
    authTelemetryLoading: loading,
    refreshAuthTelemetry: refresh,
  };
}


/**
 * Oracle API client — market data feed.
 * Talks to /api/v1/zkdefi/oracle/* endpoints.
 */

import { API_BASE } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface MarketData {
  eth_price: number;
  strk_price: number;
  gas_price?: number;
  timestamp?: string;
  [key: string]: unknown;
}

// ── API calls ────────────────────────────────────────────────────────────

/**
 * Fetch market data with optional AbortSignal and timeout.
 * Returns null on failure instead of throwing, matching the existing
 * consumer pattern in VaultSurfaceContainer.
 */
export async function getMarketData(
  signal?: AbortSignal,
): Promise<MarketData> {
  const res = await fetch(`${API_BASE}/api/v1/zkdefi/oracle/market-data`, {
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as MarketData;
}

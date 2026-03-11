"use client";

import { useState, useEffect } from "react";

/** Symbol → USD price map */
export type TokenPriceMap = Record<string, number>;

// Sensible fallbacks if CoinGecko is unreachable (updated periodically)
const FALLBACK_PRICES: TokenPriceMap = {
  ETH: 3800,
  STRK: 0.45,
  strkBTC: 95000,
  USDC: 1,
  DAI: 1,
};

// CoinGecko simple/price IDs
const CG_IDS: Record<string, string> = {
  ETH: "ethereum",
  STRK: "starknet",
  strkBTC: "bitcoin",
  USDC: "usd-coin",
  DAI: "dai",
};

/**
 * Fetches live USD prices from CoinGecko's free API.
 * Falls back to hardcoded values on failure.
 * Re-fetches every `intervalMs` (default 60 s).
 */
export function useTokenPrices(intervalMs = 60_000): { prices: TokenPriceMap; loading: boolean } {
  const [prices, setPrices] = useState<TokenPriceMap>(FALLBACK_PRICES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchPrices = async () => {
      try {
        const ids = Object.values(CG_IDS).join(",");
        // Proxy through our backend to avoid CORS blocks from CoinGecko
        const res = await fetch(
          `/api/v1/zkdefi/prices?ids=${ids}&vs=usd`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) throw new Error(`Price proxy ${res.status}`);
        const data = await res.json();

        if (!cancelled) {
          const next: TokenPriceMap = { ...FALLBACK_PRICES };
          for (const [symbol, cgId] of Object.entries(CG_IDS)) {
            const p = data?.[cgId]?.usd;
            if (typeof p === "number" && p > 0) next[symbol] = p;
          }
          setPrices(next);
        }
      } catch {
        // keep existing prices (fallback on first load)
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPrices();
    const timer = setInterval(fetchPrices, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [intervalMs]);

  return { prices, loading };
}

/** Convenience: look up price for a symbol, returns 0 if unknown */
export function priceOf(prices: TokenPriceMap, symbol: string): number {
  return prices[symbol] ?? prices[symbol.toUpperCase()] ?? 0;
}

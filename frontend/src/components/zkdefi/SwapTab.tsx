"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield } from "lucide-react";
import { useTradeContext } from "@/contexts/TradeContext";
import { useGateContext } from "@/hooks/useGateContext";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import { useApp, ActivityEvent } from "@/lib/AppContext";
import { getEkuboCapabilities, getMarketSurface } from "@/lib/api/ekubo";
import { EkuboCapabilities, MarketSurfaceResponse } from "@/types/ekubo";
import { EkuboSwapPanel, OperateHubEvent } from "./EkuboSwapPanel";

/* ── Props ─────────────────────────────────────────────────────────── */

interface SwapTabProps {
  userAddress: string;
  gateMode?: "balanced" | "stress";
}

/* ── Helpers ───────────────────────────────────────────────────────── */

const DEFAULT_TOKEN_IN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"; // STRK
const DEFAULT_TOKEN_OUT = "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23"; // fUSDC

function normalizeAddressKey(input: string): string {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return "";
  const withoutPrefix = raw.startsWith("0x") ? raw.slice(2) : raw;
  const stripped = withoutPrefix.replace(/^0+/, "");
  return `0x${stripped || "0"}`;
}

function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalizeAddressKey(a) === normalizeAddressKey(b);
}

/* ── Component ─────────────────────────────────────────────────────── */

export function SwapTab({ userAddress, gateMode: gateModeProp = "balanced" }: SwapTabProps) {
  const { setActivityFeed } = useApp();
  const trade = useTradeContext();
  const [tokenIn, setTokenInLocal] = useState(trade.tokenIn || DEFAULT_TOKEN_IN);
  const [tokenOut, setTokenOutLocal] = useState(trade.tokenOut || DEFAULT_TOKEN_OUT);

  const setTokenIn = useCallback((v: string) => {
    setTokenInLocal(v);
    trade.setTokenIn(v);
  }, [trade]);

  const setTokenOut = useCallback((v: string) => {
    setTokenOutLocal(v);
    trade.setTokenOut(v);
  }, [trade]);

  useEffect(() => {
    if (trade.tokenIn && trade.tokenIn !== tokenIn) setTokenInLocal(trade.tokenIn);
    if (trade.tokenOut && trade.tokenOut !== tokenOut) setTokenOutLocal(trade.tokenOut);
    // Only react to context changes, not local ones
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.tokenIn, trade.tokenOut]);
  const [capabilities, setCapabilities] = useState<EkuboCapabilities | null>(null);
  const [marketData, setMarketData] = useState<MarketSurfaceResponse | null>(null);
  const { gateConfig } = useGateContext(userAddress, gateModeProp);

  /* ── Data loading ─── */

  useEffect(() => {
    let cancelled = false;
    getEkuboCapabilities().then((d) => { if (!cancelled) setCapabilities(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadMarket = useCallback(async () => {
    try { setMarketData(await getMarketSurface()); } catch { /* silent */ }
  }, []);
  useEffect(() => { void loadMarket(); }, [loadMarket]);
  useVisibilityPolling(() => void loadMarket(), 30_000, [loadMarket]);

  /* ── Derived ─── */

  const selectedPairOpp = useMemo(() => {
    const opps = marketData?.opportunities ?? [];
    return opps.find((r) => sameAddress(r.token0, tokenIn) && sameAddress(r.token1, tokenOut))
      ?? opps.find((r) => sameAddress(r.token0, tokenOut) && sameAddress(r.token1, tokenIn))
      ?? null;
  }, [marketData, tokenIn, tokenOut]);

  const pushActivity = useCallback(
    (event: OperateHubEvent) => {
      const entry: ActivityEvent = {
        id: Math.random().toString(36).slice(2, 10),
        type: event.type,
        pool: "ekubo",
        text: event.text,
        details: event.details,
        txHash: event.txHash,
        status: event.status,
        time: new Date(),
      };
      setActivityFeed((prev) => [entry, ...prev].slice(0, 100));
    },
    [setActivityFeed],
  );

  /* ── Render ─── */

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-lg">
        <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2 mb-4">
          <Shield className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            Swaps are proof-gated: your risk passport and session key constraints are verified before execution. Trade intent is never broadcast publicly — commit-reveal protects against MEV.
          </span>
        </div>
        <EkuboSwapPanel
          tokenIn={tokenIn}
          tokenOut={tokenOut}
          onTokenChange={(nextIn, nextOut) => {
            setTokenIn(nextIn);
            setTokenOut(nextOut);
          }}
          capabilities={capabilities}
          pairMarketHint={selectedPairOpp}
          gateConfig={gateConfig}
          onEvent={pushActivity}
        />
      </div>
    </div>
  );
}

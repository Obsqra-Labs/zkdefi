"use client";

/**
 * VaultTradeTab — Swap, LP, Limits inside Vault (no Markets; discovery lives in Oracle).
 * Wrapped in TradeContextProvider. Optional "See all in Oracle" link.
 */

import { useState, useCallback } from "react";
import { ArrowDownUp, Droplets, Clock, Settings2, RotateCcw, ExternalLink, Repeat } from "lucide-react";
import { SwapTab } from "@/components/zkdefi/SwapTab";
import { LiquidityTab } from "@/components/zkdefi/LiquidityTab";
import { LimitOrdersPanel } from "@/components/zkdefi/LimitOrdersPanel";
import { DexPanel } from "@/components/zkdefi/DexPanel";
import { DCAPanel } from "./DCAPanel";
import {
  TradeContextProvider,
  useTradeContext,
  type TradeMode,
} from "@/contexts/TradeContext";
import { resolveTokenSymbol } from "@/lib/tokens";

type TradeSubTab = "swap" | "lp" | "limits" | "dca";

const TAB_TO_MODE: Partial<Record<TradeSubTab, TradeMode>> = {
  swap: "swap",
  lp: "lp",
  limits: "limit",
};

const TAB_META: { id: TradeSubTab; label: string; icon: React.ReactNode }[] = [
  { id: "swap", label: "Swap", icon: <ArrowDownUp className="w-4 h-4" /> },
  { id: "lp", label: "LP", icon: <Droplets className="w-4 h-4" /> },
  { id: "limits", label: "Limits", icon: <Clock className="w-4 h-4" /> },
  { id: "dca", label: "DCA", icon: <Repeat className="w-4 h-4" /> },
];

function shortSymbol(addr: string): string {
  if (!addr) return "—";
  return resolveTokenSymbol(addr);
}

export interface VaultTradeTabProps {
  address: string | undefined;
  initialSubTab?: TradeSubTab;
  onNavigateToOracle?: () => void;
  isDemo?: boolean;
}

function VaultTradeTabInner({
  address,
  initialSubTab = "swap",
  onNavigateToOracle,
  isDemo,
}: VaultTradeTabProps) {
  const trade = useTradeContext();
  const [subTab, setSubTab] = useState<TradeSubTab>(initialSubTab);
  const [showSlippage, setShowSlippage] = useState(false);

  const handleTabChange = useCallback(
    (tab: TradeSubTab) => {
      setSubTab(tab);
      const modeForTab = TAB_TO_MODE[tab];
      if (modeForTab) trade.setMode(modeForTab);
    },
    [trade],
  );

  return (
    <div className="space-y-6">
      {onNavigateToOracle && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Top opportunities</span>
          <button
            type="button"
            onClick={onNavigateToOracle}
            className="text-sm text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
          >
            See all in Oracle
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex gap-2 border-b border-zinc-800 pb-3 flex-wrap">
        {TAB_META.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleTabChange(t.id)}
            className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${
              subTab === t.id
                ? "bg-emerald-600 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="glass rounded-xl border border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Trade Intent</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSlippage((s) => !s)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="Slippage settings"
            >
              <Settings2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={trade.reset}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="Reset"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Token In</label>
            <div className="relative">
              <input
                type="text"
                value={trade.tokenIn}
                onChange={(e) => trade.setTokenIn(e.target.value)}
                placeholder="0x... or symbol"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white font-mono text-sm focus:border-emerald-500/50 focus:outline-none pr-14"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-400 font-medium">
                {shortSymbol(trade.tokenIn)}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Token Out</label>
            <div className="relative">
              <input
                type="text"
                value={trade.tokenOut}
                onChange={(e) => trade.setTokenOut(e.target.value)}
                placeholder="0x... or symbol"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white font-mono text-sm focus:border-emerald-500/50 focus:outline-none pr-14"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-cyan-400 font-medium">
                {shortSymbol(trade.tokenOut)}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Amount</label>
            <input
              type="text"
              value={trade.amount}
              onChange={(e) => trade.setAmount(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white font-mono text-sm focus:border-emerald-500/50 focus:outline-none"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={trade.flipPair}
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white transition-colors text-sm"
              title="Flip pair"
            >
              <ArrowDownUp className="w-4 h-4" />
            </button>
            <div className="text-xs text-zinc-500 pb-2">
              Mode: <span className="text-zinc-300 capitalize">{trade.mode}</span>
            </div>
          </div>
        </div>
        {showSlippage && (
          <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-3">
            <span className="text-xs text-zinc-500">Slippage:</span>
            {[25, 50, 100, 200].map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => trade.setSlippageBps(bps)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  trade.slippageBps === bps
                    ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {(bps / 100).toFixed(2)}%
              </button>
            ))}
            <input
              type="number"
              value={trade.slippageBps}
              onChange={(e) => trade.setSlippageBps(Number(e.target.value) || 50)}
              className="w-20 px-2 py-1 rounded-md bg-zinc-900 border border-zinc-700 text-white text-xs font-mono focus:border-emerald-500/50 focus:outline-none"
              min={1}
              max={5000}
            />
            <span className="text-xs text-zinc-600">bps</span>
          </div>
        )}
      </div>

      {subTab === "swap" && (
        <div className="max-w-4xl">
          {address ? <SwapTab userAddress={address} /> : <DexPanel />}
        </div>
      )}
      {subTab === "lp" && (
        <div>
          {address ? (
            <LiquidityTab userAddress={address} onNavigate={() => {}} />
          ) : (
            <div className="glass rounded-xl border border-zinc-800 p-8 text-center">
              <Droplets className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
              <h3 className="font-semibold text-zinc-200 mb-2">Connect Wallet</h3>
              <p className="text-sm text-zinc-500">Connect your wallet to manage liquidity.</p>
            </div>
          )}
        </div>
      )}
      {subTab === "limits" && (
        <div>
          {address ? (
            <LimitOrdersPanel />
          ) : (
            <div className="glass rounded-xl border border-zinc-800 p-8 text-center">
              <Clock className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
              <h3 className="font-semibold text-zinc-200 mb-2">Connect Wallet</h3>
              <p className="text-sm text-zinc-500">Connect your wallet to place limit orders.</p>
            </div>
          )}
        </div>
      )}
      {subTab === "dca" && (
        <DCAPanel address={address} isDemo={isDemo} />
      )}
    </div>
  );
}

export function VaultTradeTab(props: VaultTradeTabProps) {
  const initialMode = props.initialSubTab ? TAB_TO_MODE[props.initialSubTab] : undefined;
  return (
    <TradeContextProvider initialMode={initialMode}>
      <VaultTradeTabInner {...props} />
    </TradeContextProvider>
  );
}

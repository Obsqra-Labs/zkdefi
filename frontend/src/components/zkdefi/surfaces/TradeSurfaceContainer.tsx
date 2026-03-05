"use client";

/**
 * TradeSurfaceContainer — canonical trade surface.
 *
 * WP-3 Trade Unification:
 * - Shared TradeContext (tokenIn, tokenOut, amount, mode, slippage)
 * - 5 sub-tabs: Markets · Swap · LP · Limits · Staking
 * - Markets onTrade callback feeds TradeContext and switches sub-tab
 * - De-duped entry points: all trade actions route through this surface
 * - Token context bar visible across swap/lp/limit/stake sub-tabs
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  TrendingUp,
  ArrowDownUp,
  Droplets,
  Clock,
  Coins,
  Settings2,
  RotateCcw,
} from "lucide-react";

// Leaf components (unchanged — consumed as-is)
import { MarketsTab } from "@/components/zkdefi/MarketsTab";
import { DexPanel } from "@/components/zkdefi/DexPanel";
import { SwapTab } from "@/components/zkdefi/SwapTab";
import { LiquidityTab } from "@/components/zkdefi/LiquidityTab";
import { LimitOrdersPanel } from "@/components/zkdefi/LimitOrdersPanel";
import { NativeStakingPanel } from "@/components/zkdefi/NativeStakingPanel";

// Shared trade context
import {
  TradeContextProvider,
  useTradeContext,
  type TradeMode,
} from "@/contexts/TradeContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeSubTab = "markets" | "swap" | "lp" | "limits" | "staking";

/** Map from TradeMode (context) to TradeSubTab (nav). */
const MODE_TO_TAB: Record<TradeMode, TradeSubTab> = {
  swap: "swap",
  lp: "lp",
  limit: "limits",
  stake: "staking",
};

const TAB_TO_MODE: Partial<Record<TradeSubTab, TradeMode>> = {
  swap: "swap",
  lp: "lp",
  limits: "limit",
  staking: "stake",
};

const TAB_META: { id: TradeSubTab; label: string; icon: React.ReactNode }[] = [
  { id: "markets", label: "Markets", icon: <TrendingUp className="w-4 h-4" /> },
  { id: "swap", label: "Swap", icon: <ArrowDownUp className="w-4 h-4" /> },
  { id: "lp", label: "LP", icon: <Droplets className="w-4 h-4" /> },
  { id: "limits", label: "Limits", icon: <Clock className="w-4 h-4" /> },
  { id: "staking", label: "Staking", icon: <Coins className="w-4 h-4" /> },
];

// ---------------------------------------------------------------------------
// Known tokens (shared from @/lib/tokens)
// ---------------------------------------------------------------------------

import { resolveTokenSymbol, KNOWN_TOKENS } from "@/lib/tokens";

function shortSymbol(addr: string): string {
  if (!addr) return "—";
  return resolveTokenSymbol(addr);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TradeSurfaceContainerProps {
  address: string | undefined;
  /** Initial sub-tab override (deep link compat). */
  initialSubTab?: TradeSubTab;
}

// ---------------------------------------------------------------------------
// Inner component (needs TradeContext)
// ---------------------------------------------------------------------------

function TradeSurfaceInner({
  address,
  initialSubTab = "markets",
}: TradeSurfaceContainerProps) {
  const trade = useTradeContext();
  const [subTab, setSubTab] = useState<TradeSubTab>(initialSubTab);
  const [showSlippage, setShowSlippage] = useState(false);

  // Sync context mode when user switches sub-tabs
  const handleTabChange = useCallback(
    (tab: TradeSubTab) => {
      setSubTab(tab);
      const modeForTab = TAB_TO_MODE[tab];
      if (modeForTab) trade.setMode(modeForTab);
    },
    [trade],
  );

  // MarketsTab onTrade: populate context and switch to appropriate tab
  const handleMarketTrade = useCallback(
    (pair: string, action: "swap" | "lp") => {
      // Parse pair string (e.g. "ETH/USDC" or token addresses)
      const parts = pair.split("/");
      if (parts.length === 2) {
        // Try to resolve symbols to addresses (reverse lookup)
        const reverseMap = Object.fromEntries(
          Object.entries(KNOWN_TOKENS).map(([addr, info]) => [info.symbol, addr]),
        );
        const tokenIn = reverseMap[parts[0]] || parts[0];
        const tokenOut = reverseMap[parts[1]] || parts[1];
        trade.setIntent({ tokenIn, tokenOut });
      }
      const targetTab = action === "lp" ? "lp" : "swap";
      trade.setMode(action === "lp" ? "lp" : "swap");
      setSubTab(targetTab);
    },
    [trade],
  );

  // The token context bar — shown for all tabs except markets
  const showContextBar = subTab !== "markets";

  return (
    <div className="space-y-6">
      {/* ================================================================ */}
      {/* Sub-navigation                                                   */}
      {/* ================================================================ */}
      <div className="flex gap-2 border-b border-zinc-800 pb-3 flex-wrap">
        {TAB_META.map((t) => (
          <button
            key={t.id}
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

      {/* ================================================================ */}
      {/* Shared Token Context Bar                                         */}
      {/* ================================================================ */}
      {showContextBar && (
        <div className="glass rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Trade Intent (shared across tabs)
            </p>
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
                title="Reset trade intent"
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
          {/* Slippage row */}
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
      )}

      {/* ================================================================ */}
      {/* SUB-TAB: Markets                                                 */}
      {/* ================================================================ */}
      {subTab === "markets" && (
        <MarketsTab userAddress={address} onTrade={handleMarketTrade} />
      )}

      {/* ================================================================ */}
      {/* SUB-TAB: Swap                                                    */}
      {/* ================================================================ */}
      {subTab === "swap" && (
        <div className="max-w-4xl">
          {address ? (
            <SwapTab userAddress={address} />
          ) : (
            <DexPanel />
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* SUB-TAB: LP (Liquidity)                                          */}
      {/* ================================================================ */}
      {subTab === "lp" && (
        <div>
          {address ? (
            <LiquidityTab
              userAddress={address}
              onNavigate={(tab, sub) => {
                // Allow LP tab to navigate to vault for deploy-to-ekubo
                if (tab === "vault") {
                  // Navigation handled by parent if needed
                }
              }}
            />
          ) : (
            <div className="glass rounded-xl border border-zinc-800 p-8 text-center">
              <Droplets className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
              <h3 className="font-semibold text-zinc-200 mb-2">Connect Wallet</h3>
              <p className="text-sm text-zinc-500">Connect your wallet to manage liquidity positions.</p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* SUB-TAB: Limits                                                  */}
      {/* ================================================================ */}
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

      {/* ================================================================ */}
      {/* SUB-TAB: Staking                                                 */}
      {/* ================================================================ */}
      {subTab === "staking" && (
        <div>
          {address ? (
            <NativeStakingPanel />
          ) : (
            <div className="glass rounded-xl border border-zinc-800 p-8 text-center">
              <Coins className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
              <h3 className="font-semibold text-zinc-200 mb-2">Connect Wallet</h3>
              <p className="text-sm text-zinc-500">Connect your wallet to manage staking positions.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper — mounts TradeContextProvider
// ---------------------------------------------------------------------------

export function TradeSurfaceContainer(props: TradeSurfaceContainerProps) {
  // Derive initial mode from sub-tab if provided
  const initialMode = props.initialSubTab
    ? TAB_TO_MODE[props.initialSubTab]
    : undefined;

  return (
    <TradeContextProvider initialMode={initialMode}>
      <TradeSurfaceInner {...props} />
    </TradeContextProvider>
  );
}

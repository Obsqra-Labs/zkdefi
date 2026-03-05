"use client";

/**
 * TradeContext — shared trade intent state for the Trade surface.
 *
 * Provides a single source of truth for token pair, amount, mode,
 * and slippage across all trade sub-tabs (Swap, LP, Limits, Staking).
 * When MarketsTab fires onTrade, it feeds into this context so the
 * downstream tab auto-populates.
 *
 * This is a surface-scoped context (mounted inside TradeSurfaceContainer),
 * NOT a global provider.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeMode = "swap" | "lp" | "limit" | "stake";

export interface TradeIntent {
  /** Token being sold / supplied / staked. */
  tokenIn: string;
  /** Token being bought / paired. */
  tokenOut: string;
  /** Human-readable amount (not wei). */
  amount: string;
  /** Current trade mode — drives which sub-tab is active. */
  mode: TradeMode;
  /** Slippage tolerance in basis points. */
  slippageBps: number;
}

export interface TradeContextValue extends TradeIntent {
  setTokenIn: (v: string) => void;
  setTokenOut: (v: string) => void;
  setAmount: (v: string) => void;
  setMode: (m: TradeMode) => void;
  setSlippageBps: (bps: number) => void;
  /** Convenience: set all fields at once (partial merge). */
  setIntent: (partial: Partial<TradeIntent>) => void;
  /** Swap tokenIn <-> tokenOut. */
  flipPair: () => void;
  /** Reset to defaults. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TOKEN_IN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"; // STRK
const DEFAULT_TOKEN_OUT =
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"; // ETH
const DEFAULT_SLIPPAGE_BPS = 50;

const INITIAL: TradeIntent = {
  tokenIn: DEFAULT_TOKEN_IN,
  tokenOut: DEFAULT_TOKEN_OUT,
  amount: "",
  mode: "swap",
  slippageBps: DEFAULT_SLIPPAGE_BPS,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const Ctx = createContext<TradeContextValue | null>(null);

export function useTradeContext(): TradeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTradeContext must be used within TradeContextProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface TradeContextProviderProps {
  children: ReactNode;
  /** Override initial mode (e.g. from deep link). */
  initialMode?: TradeMode;
}

export function TradeContextProvider({
  children,
  initialMode,
}: TradeContextProviderProps) {
  const [tokenIn, _setTokenIn] = useState(INITIAL.tokenIn);
  const [tokenOut, _setTokenOut] = useState(INITIAL.tokenOut);
  const [amount, _setAmount] = useState(INITIAL.amount);
  const [mode, _setMode] = useState<TradeMode>(initialMode ?? INITIAL.mode);
  const [slippageBps, _setSlippageBps] = useState(INITIAL.slippageBps);

  const setTokenIn = useCallback((v: string) => _setTokenIn(v), []);
  const setTokenOut = useCallback((v: string) => _setTokenOut(v), []);
  const setAmount = useCallback((v: string) => _setAmount(v), []);
  const setMode = useCallback((m: TradeMode) => _setMode(m), []);
  const setSlippageBps = useCallback((bps: number) => _setSlippageBps(bps), []);

  const setIntent = useCallback((partial: Partial<TradeIntent>) => {
    if (partial.tokenIn !== undefined) _setTokenIn(partial.tokenIn);
    if (partial.tokenOut !== undefined) _setTokenOut(partial.tokenOut);
    if (partial.amount !== undefined) _setAmount(partial.amount);
    if (partial.mode !== undefined) _setMode(partial.mode);
    if (partial.slippageBps !== undefined) _setSlippageBps(partial.slippageBps);
  }, []);

  const flipPair = useCallback(() => {
    _setTokenIn((prev) => {
      _setTokenOut(prev);
      return tokenOut;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenOut]);

  const reset = useCallback(() => {
    _setTokenIn(INITIAL.tokenIn);
    _setTokenOut(INITIAL.tokenOut);
    _setAmount(INITIAL.amount);
    _setMode(INITIAL.mode);
    _setSlippageBps(INITIAL.slippageBps);
  }, []);

  const value: TradeContextValue = {
    tokenIn,
    tokenOut,
    amount,
    mode,
    slippageBps,
    setTokenIn,
    setTokenOut,
    setAmount,
    setMode,
    setSlippageBps,
    setIntent,
    flipPair,
    reset,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

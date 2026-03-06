"use client";

import { createContext, useContext, useMemo, useState } from "react";

export type TradeMode = "swap" | "lp" | "limit";

interface TradeContextValue {
  mode: TradeMode;
  setMode: (mode: TradeMode) => void;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageBps: number;
  setTokenIn: (value: string) => void;
  setTokenOut: (value: string) => void;
  setAmount: (value: string) => void;
  setSlippageBps: (value: number) => void;
  flipPair: () => void;
  reset: () => void;
}

const DEFAULT_TOKEN_IN = "STRK";
const DEFAULT_TOKEN_OUT = "ETH";

const TradeContext = createContext<TradeContextValue | null>(null);

export function TradeContextProvider({
  children,
  initialMode = "swap",
}: {
  children: React.ReactNode;
  initialMode?: TradeMode;
}) {
  const [mode, setMode] = useState<TradeMode>(initialMode);
  const [tokenIn, setTokenIn] = useState(DEFAULT_TOKEN_IN);
  const [tokenOut, setTokenOut] = useState(DEFAULT_TOKEN_OUT);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);

  const value = useMemo<TradeContextValue>(
    () => ({
      mode,
      setMode,
      tokenIn,
      tokenOut,
      amount,
      slippageBps,
      setTokenIn,
      setTokenOut,
      setAmount,
      setSlippageBps,
      flipPair: () => {
        setTokenIn(tokenOut);
        setTokenOut(tokenIn);
      },
      reset: () => {
        setMode(initialMode);
        setTokenIn(DEFAULT_TOKEN_IN);
        setTokenOut(DEFAULT_TOKEN_OUT);
        setAmount("");
        setSlippageBps(50);
      },
    }),
    [amount, initialMode, mode, slippageBps, tokenIn, tokenOut],
  );

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTradeContext(): TradeContextValue {
  const context = useContext(TradeContext);
  if (!context) {
    throw new Error("useTradeContext must be used inside TradeContextProvider");
  }
  return context;
}

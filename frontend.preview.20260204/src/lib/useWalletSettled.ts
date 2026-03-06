"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@starknet-react/core";

const WALLET_SETTLE_MS = 1600;
const LAST_CONNECTOR_KEY = "lastUsedConnector";

/**
 * Returns whether the wallet connection state has "settled", so we can avoid
 * flashing "Connect Wallet" during autoConnect when navigating between pages.
 * While not settled, show a compact loading state instead of the connect CTA.
 */
export function useWalletSettled(): { settled: boolean } {
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [settleTimeoutReached, setSettleTimeoutReached] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || isConnected) return;
    const hasStored = typeof window !== "undefined" && !!localStorage.getItem(LAST_CONNECTOR_KEY);
    if (!hasStored) {
      setSettleTimeoutReached(true);
      return;
    }
    const t = setTimeout(() => setSettleTimeoutReached(true), WALLET_SETTLE_MS);
    return () => clearTimeout(t);
  }, [mounted, isConnected]);

  const settled = isConnected || !mounted || settleTimeoutReached;
  return { settled };
}

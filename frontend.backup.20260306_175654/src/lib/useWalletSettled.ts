"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@starknet-react/core";

const WALLET_SETTLE_MS = 1600;
const MAX_SETTLE_TIMEOUT_MS = 5000; // Maximum wait time to prevent infinite loading
const LAST_CONNECTOR_KEY = "lastUsedConnector";

/**
 * Returns whether the wallet connection state has "settled", so we can avoid
 * flashing "Connect Wallet" during autoConnect when navigating between pages.
 * While not settled, show a compact loading state instead of the connect CTA.
 * 
 * IMPORTANT: Has a max timeout to prevent infinite loading on production
 */
export function useWalletSettled(): { settled: boolean; timedOut: boolean } {
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [settleTimeoutReached, setSettleTimeoutReached] = useState(false);
  const [maxTimeoutReached, setMaxTimeoutReached] = useState(false);

  useEffect(() => setMounted(true), []);

  // Normal settle timeout
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

  // Fallback max timeout to prevent infinite spinner
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => {
      setMaxTimeoutReached(true);
      setSettleTimeoutReached(true);
    }, MAX_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mounted]);

  const settled = isConnected || !mounted || settleTimeoutReached || maxTimeoutReached;
  return { settled, timedOut: maxTimeoutReached && !isConnected };
}

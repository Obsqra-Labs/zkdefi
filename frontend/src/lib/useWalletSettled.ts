"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@starknet-react/core";

const WALLET_SETTLE_MS = 800;
const MAX_SETTLE_TIMEOUT_MS = 3000; // When disconnected: show Connect Gate after this
const HARD_TIMEOUT_MS = 3000;      // When reconnecting: bail out after this so we never spin forever
const LAST_CONNECTOR_KEY = "lastUsedConnector";

/**
 * Returns whether the wallet connection state has "settled", so we can avoid
 * flashing "Connect Wallet" during autoConnect when navigating between pages.
 * While not settled, show a compact loading state instead of the connect CTA.
 *
 * When status is "reconnecting" (e.g. after frontend restart), we do NOT
 * treat the short timeout as settled — so we keep showing "Connecting to
 * Starknet..." until autoConnect finishes or the hard timeout hits.
 */
export function useWalletSettled(): { settled: boolean; timedOut: boolean } {
  const { isConnected, status } = useAccount();
  const isConnectingOrReconnecting = status === "connecting" || status === "reconnecting";
  const [mounted, setMounted] = useState(false);
  const [settleTimeoutReached, setSettleTimeoutReached] = useState(false);
  const [maxTimeoutReached, setMaxTimeoutReached] = useState(false);
  const [hardTimeoutReached, setHardTimeoutReached] = useState(false);

  useEffect(() => setMounted(true), []);

  // Normal settle timeout (no stored connector = show Connect Gate soon)
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

  // Max timeout when disconnected (don’t spin forever) — do NOT force settled while reconnecting
  useEffect(() => {
    if (!mounted || isConnectingOrReconnecting) return;
    const t = setTimeout(() => {
      setMaxTimeoutReached(true);
      setSettleTimeoutReached(true);
    }, MAX_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mounted, isConnectingOrReconnecting]);

  // Hard cap: even if still "reconnecting", show Connect Gate after this so we never spin forever
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => setHardTimeoutReached(true), HARD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mounted]);

  const settled =
    isConnected ||
    !mounted ||
    settleTimeoutReached ||
    (maxTimeoutReached && !isConnectingOrReconnecting) ||
    hardTimeoutReached;
  const timedOut = (maxTimeoutReached || hardTimeoutReached) && !isConnected;
  return { settled, timedOut };
}

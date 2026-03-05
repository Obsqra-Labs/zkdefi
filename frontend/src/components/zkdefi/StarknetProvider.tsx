"use client";

import { useEffect } from "react";
import { StarknetConfig, jsonRpcProvider, argent, braavos } from "@starknet-react/core";
import { sepolia } from "@starknet-react/chains";

const DEFAULT_SEPOLIA_RPC = "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7";
const ENABLE_AUTO_CONNECT = process.env.NEXT_PUBLIC_STARKNET_AUTO_CONNECT === "true";
const CONNECTORS = [argent(), braavos()];
const PROVIDER = getProvider();

/**
 * StarknetProvider: uses NEXT_PUBLIC_RPC_URL or Alchemy Sepolia default (avoids flaky public RPC).
 * Hydration: StarknetConfig may cause hydration warnings; React recovers and the app works.
 */
function getProvider() {
  const url = process.env.NEXT_PUBLIC_RPC_URL ?? DEFAULT_SEPOLIA_RPC;
  return jsonRpcProvider({ rpc: () => ({ nodeUrl: url }) });
}

export function StarknetProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      const name =
        reason && typeof reason === "object" && "name" in reason
          ? String((reason as { name?: unknown }).name ?? "")
          : "";
      const message =
        reason && typeof reason === "object" && "message" in reason
          ? String((reason as { message?: unknown }).message ?? "")
          : String(reason ?? "");
      const lower = message.toLowerCase();
      // User-denied wallet prompts are expected and should not surface as uncaught errors.
      if (name === "UserRejectedRequestError" || lower.includes("user rejected request")) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return (
    <StarknetConfig
      chains={[sepolia]}
      provider={PROVIDER}
      connectors={CONNECTORS}
      // Disable eager reconnect by default because some wallets trigger interactive checks
      // that can spam `UserRejectedRequestError` after deploys or stale sessions.
      autoConnect={ENABLE_AUTO_CONNECT}
    >
      {children}
    </StarknetConfig>
  );
}

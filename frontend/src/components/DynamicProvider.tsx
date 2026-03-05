"use client";

import type { ReactNode } from "react";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { StarknetWalletConnectors } from "@dynamic-labs/starknet";

const dynamicEnvironmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID?.trim();
const dynamicEnabled = Boolean(dynamicEnvironmentId);

export function DynamicProvider({ children }: { children: ReactNode }) {
  if (!dynamicEnabled || !dynamicEnvironmentId) {
    return <>{children}</>;
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId: dynamicEnvironmentId,
        walletConnectors: [EthereumWalletConnectors, StarknetWalletConnectors],
        initialAuthenticationMode: "connect-only",
        bridgeChains: [{ chain: "EVM" }, { chain: "STARK" }],
        enableConnectOnlyFallback: true,
        appName: "zkde.fi",
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}

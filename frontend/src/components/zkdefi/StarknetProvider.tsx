"use client";

import { StarknetConfig, jsonRpcProvider, argent, braavos } from "@starknet-react/core";
import { sepolia } from "@starknet-react/chains";

const DEFAULT_SEPOLIA_RPC = "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7";

/**
 * StarknetProvider: uses NEXT_PUBLIC_RPC_URL or Alchemy Sepolia default (avoids flaky public RPC).
 * Hydration: StarknetConfig may cause hydration warnings; React recovers and the app works.
 */
function getProvider() {
  const url = process.env.NEXT_PUBLIC_RPC_URL ?? DEFAULT_SEPOLIA_RPC;
  return jsonRpcProvider({ rpc: () => ({ nodeUrl: url }) });
}

export function StarknetProvider({ children }: { children: React.ReactNode }) {
  return (
    <StarknetConfig
      chains={[sepolia]}
      provider={getProvider()}
      connectors={[argent(), braavos()]}
      autoConnect
    >
      {children}
    </StarknetConfig>
  );
}

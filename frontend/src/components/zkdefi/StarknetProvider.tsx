"use client";

import { StarknetConfig, publicProvider, argent, braavos } from "@starknet-react/core";
import { mainnet, sepolia } from "@starknet-react/chains";

/**
 * StarknetProvider wrapper for the app.
 * 
 * Note: The publicProvider() uses default Starknet RPC which can sometimes be slow.
 * For production, consider setting NEXT_PUBLIC_RPC_URL to a dedicated provider like:
 * - Alchemy: https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY
 * - BlastAPI: https://starknet-sepolia.public.blastapi.io
 * - Nethermind: https://free-rpc.nethermind.io/sepolia-juno
 * 
 * Hydration note: StarknetConfig may cause React hydration warnings because
 * wallet connectors initialize differently on server vs client. This is expected
 * and doesn't affect functionality - React will recover and the app works correctly.
 */
export function StarknetProvider({ children }: { children: React.ReactNode }) {
  return (
    <StarknetConfig
      chains={[mainnet, sepolia]}
      provider={publicProvider()}
      connectors={[argent(), braavos()]}
      autoConnect
    >
      {children}
    </StarknetConfig>
  );
}

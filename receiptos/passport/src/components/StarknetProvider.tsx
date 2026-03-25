"use client";

import {
  StarknetConfig,
  publicProvider,
  argent,
  braavos,
} from "@starknet-react/core";
import { sepolia } from "@starknet-react/chains";

export function StarknetProvider({ children }: { children: React.ReactNode }) {
  return (
    <StarknetConfig
      chains={[sepolia]}
      provider={publicProvider()}
      connectors={[argent(), braavos()]}
      autoConnect
    >
      {children}
    </StarknetConfig>
  );
}

import type { SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";

export interface LiquidationResult {
  liquidation_count: number | null;
  predicate: "has_lending_activity" | "no_lending_activity";
}

export async function getLiquidationCount(
  _rpc: StarknetRPC,
  _wallet: string
): Promise<SignalResult<LiquidationResult>> {
  return {
    value: {
      liquidation_count: null,
      predicate: "no_lending_activity",
    },
    source: "unresolved_lending_events",
    blockRange: [0, 0],
    requestCount: 0,
  };
}

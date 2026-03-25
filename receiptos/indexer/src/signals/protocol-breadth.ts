import type { SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";

export interface ProtocolBreadth {
  categories: string[];
  count: number;
}

export async function getProtocolBreadth(
  _rpc: StarknetRPC,
  _wallet: string
): Promise<SignalResult<ProtocolBreadth>> {
  return {
    value: { categories: [], count: 0 },
    source: "unresolved_protocol_mapping",
    blockRange: [0, 0],
    requestCount: 0,
  };
}

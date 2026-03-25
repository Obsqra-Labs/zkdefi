import type { BridgeInflow, SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";

export async function getBridgeInflow(
  _rpc: StarknetRPC,
  _wallet: string
): Promise<SignalResult<BridgeInflow | null>> {
  return {
    value: null,
    source: "unresolved_bridge_contracts",
    blockRange: [0, 0],
    requestCount: 0,
  };
}

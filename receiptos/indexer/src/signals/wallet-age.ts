import type { SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";

export async function getWalletAge(
  _rpc: StarknetRPC,
  _wallet: string
): Promise<SignalResult<number | null>> {
  return {
    value: null,
    source: "unresolved_wallet_age_strategy",
    blockRange: [0, 0],
    requestCount: 0,
  };
}

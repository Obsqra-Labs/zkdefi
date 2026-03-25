import type { SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";

export async function getTransactionCount(
  rpc: StarknetRPC,
  wallet: string
): Promise<SignalResult<number>> {
  const nonce = await rpc.getNonce(wallet);
  return {
    value: nonce,
    source: "starknet_getNonce",
    blockRange: [0, 0],
    requestCount: 1,
  };
}

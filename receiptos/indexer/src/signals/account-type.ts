import type { SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";
import classHashConfig from "../../../config/account-class-hashes.json";

type AccountType = "argent" | "braavos" | "openzeppelin" | "unknown";

type ClassHashEntry = {
  class_hash: string;
  verified: boolean;
  verified_wallets?: string[];
  source?: string;
  notes?: string;
};

export async function getAccountType(
  rpc: StarknetRPC,
  wallet: string
): Promise<SignalResult<AccountType | null>> {
  let classHash: string;
  try {
    classHash = await rpc.getClassHashAt(wallet);
  } catch {
    return {
      value: null,
      source: "starknet_getClassHashAt_failed",
      blockRange: [0, 0],
      requestCount: 1,
    };
  }
  const config = classHashConfig as unknown as Record<string, ClassHashEntry>;
  
  let value: AccountType = "unknown";

  if (config.argent?.class_hash === classHash) value = "argent";
  else if (config.braavos?.class_hash === classHash) value = "braavos";
  else if (config.openzeppelin?.class_hash === classHash && config.openzeppelin?.class_hash !== "unresolved") value = "openzeppelin";

  return {
    value,
    source: "starknet_getClassHashAt + account-class-hashes.json",
    blockRange: [0, 0],
    requestCount: 1,
  };
}

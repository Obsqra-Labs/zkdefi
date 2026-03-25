import type { SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";
import classHashes from "../../../config/account-class-hashes.json";

type AccountType = "argent" | "braavos" | "openzeppelin" | "unknown";
type ClassHashConfig = {
  argent: string[];
  braavos: string[];
  openzeppelin: string[];
};

export async function getAccountType(
  rpc: StarknetRPC,
  wallet: string
): Promise<SignalResult<AccountType>> {
  const classHash = await rpc.getClassHashAt(wallet);
  const knownClassHashes = classHashes as unknown as ClassHashConfig;
  let value: AccountType = "unknown";

  if (knownClassHashes.argent.includes(classHash)) value = "argent";
  else if (knownClassHashes.braavos.includes(classHash)) value = "braavos";
  else if (knownClassHashes.openzeppelin.includes(classHash)) value = "openzeppelin";

  return {
    value,
    source: "starknet_getClassHashAt",
    blockRange: [0, 0],
    requestCount: 1,
  };
}

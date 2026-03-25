import { hash } from "starknet";

const FELT_MAX = BigInt("0x800000000000011000000000000000000000000000000000000000000000000");
const ACCOUNT_TYPE_MAP: Record<string, bigint> = {
  argent: 1n,
  braavos: 2n,
  openzeppelin: 3n,
  unknown: 0n,
};

export interface VectorForPolicyHash {
  wallet: string;
  timestamp: number;
  signals: {
    wallet_age_days: number | null;
    account_type: "argent" | "braavos" | "openzeppelin" | "unknown";
    transaction_count: number;
    protocol_category_count: number;
    liquidation_count: number | null;
    bridge_inflow: { total_events: number } | null;
  };
}

export function computePolicyHash(vector: VectorForPolicyHash): string {
  const fields = [
    BigInt(vector.wallet),
    BigInt(vector.signals.wallet_age_days ?? 0),
    ACCOUNT_TYPE_MAP[vector.signals.account_type],
    BigInt(vector.signals.transaction_count),
    BigInt(vector.signals.protocol_category_count),
    vector.signals.liquidation_count === null ? FELT_MAX : BigInt(vector.signals.liquidation_count),
    BigInt(vector.signals.bridge_inflow?.total_events ?? 0),
    BigInt(hash.starknetKeccak("0.1.0")),
    BigInt(vector.timestamp),
  ];

  return hash.computePoseidonHashOnElements(fields.map((f) => `0x${f.toString(16)}`));
}

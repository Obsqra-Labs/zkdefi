import { hash } from "starknet";
const FELT_MAX = BigInt("0x800000000000011000000000000000000000000000000000000000000000000");
const ACCOUNT_TYPE_MAP = {
    argent: 1n,
    braavos: 2n,
    openzeppelin: 3n,
    unknown: 0n,
};
export function computePolicyHash(vector) {
    const fields = [
        BigInt(vector.wallet),
        BigInt(vector.signals.wallet_age_days ?? 0),
        ACCOUNT_TYPE_MAP[vector.signals.account_type ?? "unknown"],
        BigInt(vector.signals.transaction_count),
        BigInt(vector.signals.protocol_category_count),
        vector.signals.liquidation_count === null ? FELT_MAX : BigInt(vector.signals.liquidation_count),
        BigInt(vector.signals.bridge_inflow?.total_events ?? 0),
        BigInt(hash.starknetKeccak("0.1.0")),
        BigInt(vector.timestamp),
    ];
    return hash.computePoseidonHashOnElements(fields.map((f) => `0x${f.toString(16)}`));
}

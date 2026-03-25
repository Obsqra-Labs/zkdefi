/** ReceiptRegistry contract constants + minimal ABI (Sepolia) */

export const RECEIPT_REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_RECEIPTOS_CONTRACT ??
  "0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff";

export const STARKNET_RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC ??
  "https://free-rpc.nethermind.io/sepolia-juno";

/**
 * Minimal ABI fragments used by the passport app.
 * Only read-only calls — the passport never submits write txns from the browser.
 */
export const RECEIPT_REGISTRY_ABI = [
  {
    name: "verify_receipt",
    type: "function",
    inputs: [{ name: "receipt_id", type: "core::integer::u64" }],
    outputs: [{ type: "core::bool" }],
    state_mutability: "view",
  },
  {
    name: "get_receipt_policy_hash",
    type: "function",
    inputs: [{ name: "receipt_id", type: "core::integer::u64" }],
    outputs: [{ type: "core::felt252" }],
    state_mutability: "view",
  },
  {
    name: "get_receipt_weight",
    type: "function",
    inputs: [{ name: "receipt_id", type: "core::integer::u64" }],
    outputs: [{ type: "core::integer::u128" }],
    state_mutability: "view",
  },
  {
    name: "get_receipt_nullifier",
    type: "function",
    inputs: [{ name: "receipt_id", type: "core::integer::u64" }],
    outputs: [{ type: "core::felt252" }],
    state_mutability: "view",
  },
  {
    name: "get_next_receipt_id",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
  {
    name: "get_attester_pubkey",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::felt252" }],
    state_mutability: "view",
  },
  {
    name: "is_policy_hash_used",
    type: "function",
    inputs: [{ name: "policy_hash", type: "core::felt252" }],
    outputs: [{ type: "core::bool" }],
    state_mutability: "view",
  },
] as const;

/** Starknet Sepolia — single source for explorer links (landing + /test). */

export const STARKNET_VOYAGER = "https://sepolia.voyager.online/contract";

export const STARKNET_CONTRACTS = [
  { name: "ReputationRegistry", address: "0x10d00b33b5683afd776c58638a222aa10605d7eeafa95979b5246312b7e022" },
  { name: "FullPrivacyPoolV2", address: "0x03dde5617d362a6f9202cd3955b4508e2bd6b1c5d35250153beeb6237c811559" },
  { name: "ReceiptRegistry", address: "0x02900291a932aa63f6510b9320e13fc25cf2dd7c2274ebe3a671ec6daecd83cd" },
  { name: "VaultController", address: "0x2f29b985bc962f065160828296ab3889769a92a313d11077f186a81d0853b63" },
  { name: "GaragaVerifier", address: "0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37" },
  { name: "ModelBridgeVerifier", address: "0x037c42e8734271aca0c3c1bdf1746d9ccc098ddfd5ee211c94bbb8786fa4626f" },
  { name: "ZkmlVerifier", address: "0x068abd64a4a78172a5ee15a30bbe614257d62482f07d3ff7fdb72da5aad08923" },
] as const;

export function voyagerContractUrl(address: string): string {
  const a = address.replace(/^0x/i, "");
  return `${STARKNET_VOYAGER}/${a}`;
}
